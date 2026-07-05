import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AgentState } from '../../generated/contracts';

export interface CameraFrame {
  targetY: number;
  distance: number;
}

export function computeCameraFrame(width: number, height: number, aspect: number, verticalFovDegrees = 35): CameraFrame {
  const safeHeight = Math.max(height, 0.001);
  const safeWidth = Math.max(width, 0.001);
  const verticalFov = THREE.MathUtils.degToRad(verticalFovDegrees);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(aspect, 0.001));
  const verticalDistance = (safeHeight / 2) / Math.tan(verticalFov / 2);
  const horizontalDistance = (safeWidth / 2) / Math.tan(horizontalFov / 2);
  return { targetY: safeHeight * 0.52, distance: Math.max(verticalDistance, horizontalDistance) * 1.24 };
}

interface SceneHandlers {
  onProgress: (progress: number) => void;
  onReady: () => void;
  onError: (message: string) => void;
}

export class ThreeAvatarScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly loader = new GLTFLoader();
  private readonly resizeObserver: ResizeObserver;
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private talkingAction: THREE.AnimationAction | null = null;
  private animationFrame = 0;
  private timeout = 0;
  private frame: CameraFrame | null = null;
  private state: AgentState = 'idle';
  private disposed = false;

  constructor(private readonly container: HTMLElement, private readonly handlers: SceneHandlers) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.setAttribute('aria-label', 'Vanguard 3D avatar');
    this.renderer.domElement.className = 'h-full w-full';
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x8faed3);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x303744, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-3, 5, -4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xa8c8ff, 1.4);
    fill.position.set(4, 2, 3);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(8, 64),
      new THREE.MeshStandardMaterial({ color: 0x66717d, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.006;
    this.scene.add(ground);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  load(url: string): void {
    this.timeout = window.setTimeout(() => this.fail('3D 角色加载超过 30 秒。'), 30_000);
    this.loader.load(url, (gltf) => {
      if (this.disposed) return;
      window.clearTimeout(this.timeout);
      this.model = gltf.scene;
      const initialBox = new THREE.Box3().setFromObject(this.model);
      const center = initialBox.getCenter(new THREE.Vector3());
      this.model.position.set(-center.x, -initialBox.min.y, -center.z);
      this.model.rotation.y = Math.PI;
      this.scene.add(this.model);

      const box = new THREE.Box3().setFromObject(this.model);
      const size = box.getSize(new THREE.Vector3());
      this.frame = computeCameraFrame(size.x, size.y, this.camera.aspect, this.camera.fov);
      this.mixer = new THREE.AnimationMixer(this.model);
      const talking = gltf.animations.find((clip) => clip.name.toLowerCase() === 'talking') ?? gltf.animations[0];
      if (talking) {
        this.talkingAction = this.mixer.clipAction(talking);
        this.talkingAction.setLoop(THREE.LoopRepeat, Infinity);
        this.setIdlePose();
      }
      this.applyState();
      this.resize();
      this.handlers.onReady();
    }, (event) => {
      if (event.total > 0) this.handlers.onProgress(Math.min(event.loaded / event.total, 1));
    }, (error) => this.fail(error instanceof Error ? error.message : '无法加载 3D 角色。'));
    this.animate();
  }

  setState(state: AgentState): void {
    this.state = state;
    this.applyState();
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.timeout);
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.mixer?.stopAllAction();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyState(): void {
    if (!this.talkingAction) return;
    if (this.state === 'speaking') {
      this.talkingAction.paused = false;
      if (!this.talkingAction.isRunning()) this.talkingAction.reset().setEffectiveWeight(1).fadeIn(0.15).play();
    } else if (!this.talkingAction.paused) {
      this.talkingAction.fadeOut(0.15);
      window.setTimeout(() => {
        if (this.state !== 'speaking') this.setIdlePose();
      }, 180);
    }
  }

  private setIdlePose(): void {
    if (!this.talkingAction || !this.mixer) return;
    this.talkingAction.stop().reset().setEffectiveWeight(1).play();
    const idleTime = this.talkingAction.getClip().duration * 0.5;
    this.talkingAction.paused = false;
    this.mixer.setTime(idleTime);
    this.talkingAction.paused = true;
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.model) {
      const size = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3());
      this.frame = computeCameraFrame(size.x, size.y, this.camera.aspect, this.camera.fov);
    }
    if (this.frame) {
      this.camera.position.set(0, this.frame.targetY, -this.frame.distance);
      this.camera.lookAt(0, this.frame.targetY, 0);
    }
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    this.mixer?.update(Math.min(this.clock.getDelta(), 0.05));
    this.renderer.render(this.scene, this.camera);
  };

  private fail(message: string): void {
    if (this.disposed) return;
    window.clearTimeout(this.timeout);
    this.handlers.onError(message);
  }
}
"""Convert the original Vanguard FBX model and Talking animation to a web-ready GLB.

Run with Blender 4.5 LTS:
  blender --background --python scripts/convert-vanguard.py -- <model.fbx> <talking.fbx> <texture-dir> <output.glb>
"""
from __future__ import annotations

import sys
from pathlib import Path
import bpy


def arguments() -> tuple[Path, Path, Path, Path]:
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) != 4:
        raise SystemExit("Expected: model.fbx talking.fbx texture-dir output.glb")
    return tuple(Path(item).resolve() for item in argv)  # type: ignore[return-value]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def load_image(path: Path, colorspace: str):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = colorspace
    return image


def apply_materials(texture_dir: Path) -> None:
    diffuse = load_image(texture_dir / "vanguard_diffuse1.png", "sRGB")
    normal = load_image(texture_dir / "vanguard_normal.png", "Non-Color")
    specular = load_image(texture_dir / "vanguard_specular.png", "Non-Color")
    materials = {slot.material for obj in bpy.data.objects if obj.type == "MESH" for slot in obj.material_slots if slot.material}
    for material in materials:
        material.use_nodes = True
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        base = nodes.new("ShaderNodeTexImage")
        base.image = diffuse
        normal_texture = nodes.new("ShaderNodeTexImage")
        normal_texture.image = normal
        normal_map = nodes.new("ShaderNodeNormalMap")
        spec = nodes.new("ShaderNodeTexImage")
        spec.image = specular
        links.new(base.outputs["Color"], shader.inputs["Base Color"])
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
        # The legacy specular map is used as roughness information after inversion.
        invert = nodes.new("ShaderNodeInvert")
        links.new(spec.outputs["Color"], invert.inputs["Color"])
        links.new(invert.outputs["Color"], shader.inputs["Roughness"])
        shader.inputs["Metallic"].default_value = 0.15
        links.new(shader.outputs["BSDF"], output.inputs["Surface"])


def find_armature(objects):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("FBX did not contain an armature")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def strip_root_motion(action) -> None:
    # Blender 4.5 stores FBX curves in layered Action channel bags.
    # Remove model/root translation while preserving rotational body motion.
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                channelbag = strip.channelbag(slot)
                if channelbag is None:
                    continue
                for curve in list(channelbag.fcurves):
                    path = curve.data_path.lower()
                    is_object_translation = path == "location"
                    is_root_translation = path.endswith(".location") and ("hips" in path or "root" in path)
                    if is_object_translation or is_root_translation:
                        channelbag.fcurves.remove(curve)


def main() -> None:
    model_path, talking_path, texture_dir, output_path = arguments()
    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(model_path), use_anim=False, automatic_bone_orientation=False)
    model_objects = list(bpy.context.scene.objects)
    main_armature = find_armature(model_objects)
    apply_materials(texture_dir)

    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=str(talking_path), use_anim=True, automatic_bone_orientation=False)
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    talking_armature = find_armature(imported)
    if not talking_armature.animation_data or not talking_armature.animation_data.action:
        raise RuntimeError("Talking FBX did not contain an animation action")
    source_action = talking_armature.animation_data.action
    talking_action = source_action.copy()
    talking_action.name = "Talking"
    talking_action.use_fake_user = True
    strip_root_motion(talking_action)

    talking_armature.animation_data.action = None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in imported:
        obj.select_set(True)
    bpy.ops.object.delete(use_global=False)

    main_armature.animation_data_create()
    main_armature.animation_data.action = talking_action
    main_armature.animation_data.action_slot = talking_action.slots[0]
    bpy.data.actions.remove(source_action)
    for obj in model_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = main_armature

    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_force_sampling=False,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_morph=True,
        export_apply=False,
        export_image_format="AUTO",
        export_texture_dir="",
    )
    print(f"Exported {output_path} ({output_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
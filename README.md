<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>
Garfield Chat Live v1.0.0
==========================

一个在 AI 助手（如 GitHub Copilot 等）协助下完成的、基于双猫咪形象的多模态聊天助手，支持文本对话、语音识别、语音合成和桌面应用打包（Electron）。

---

1. 使用的主要库
----------------

- 前端框架
   - `react` / `react-dom`：构建单页应用 UI。
   - `@vitejs/plugin-react`：Vite 的 React 插件。

- 构建与工具链
   - `vite`：前端开发/打包工具。
   - `typescript`：TypeScript 支持。

- 桌面端
   - `electron`：构建桌面应用。
   - `electron-builder`：打包生成 Windows 安装程序（NSIS）。

> 打包说明：本项目的桌面端使用 **Electron** 作为“内核”，内部集成了 **Chromium 浏览器内核** 与 **Node.js 运行时**。前端部分先通过 **Vite** 打包为静态资源（输出到 `dist/`），再由 `electron-builder` 将这些资源连同 Electron 一起封装成 Windows 可执行程序和安装包。

- 图标与样式
   - `@heroicons/react`：右下角悬浮按钮图标（音量、麦克风等）。
   - `tailwindcss`（CDN 版）：基础样式与布局，在 `index.html` 中通过 `<script src="https://cdn.tailwindcss.com"></script>` 引入。

- 工具库
   - `uuid`：为聊天消息生成唯一 ID。
   - `crypto-js`：进行 HMAC/签名计算（讯飞接口）。
   - `@types/crypto-js`、`@types/node`：对应的类型声明。

---

2. 调用的第三方服务
--------------------

### 2.1 大模型 / 对话

- **DeepSeek / OpenAI 兼容接口**  
   通过 `services/geminiService.ts` 中的 `setApiConfig` 进行配置。
   - 用途：
      - 文本对话（根据历史消息生成回复）。
      - 把回复文本发送到 TTS 生成语音。

### 2.2 语音识别（ASR）

- **科大讯飞 WebSocket 语音识别**  
   实现文件：`services/speechRecognition.ts`。
   - 主要类：`XunfeiSpeechService`。
   - 特点：
      - 按住麦克风录音，松开后继续等待完整识别结果。
      - 使用 `appid`、`apiKey`、`apiSecret` 等做 HMAC 鉴权。
      - 结果会回填到输入框，由用户决定是否发送。

### 2.3 语音合成（TTS）

- **科大讯飞 TTS + 星火超拟人 TTS**  
   实现集中在 `services/geminiService.ts` 的 `customApiHandlers.textToSpeech`：
   - 根据当前猫咪性别/角色选择不同音色。
   - 若超拟人 TTS 权限不足，则自动回退到普通 TTS。
   - 通过 WebSocket 接收 24kHz PCM 音频流，前端解码后播放。

### 2.4 前端音频播放

- 使用浏览器 `AudioContext`：
   - 工具文件：`services/audioUtils.ts`。
   - 功能：Base64 → 二进制 → `AudioBuffer` → 排队播放，支持音量控制与多段连续播放。

---

3. 项目框架与目录结构
----------------------

### 3.1 技术栈概览

- 前端：React + TypeScript + Vite。
- 桌面端：Electron + electron-builder。
- 语音与对话：科大讯飞（ASR + TTS）+ DeepSeek / OpenAI 兼容接口（LLM）。

### 3.2 主要目录与文件

- 根目录
   - `index.html`：入口 HTML，加载 Tailwind 与全局动画 CSS（如猫咪呼吸、尾巴摇摆、小鱼干掉落等）。
   - `index.tsx`：React 入口，挂载 `App` 组件。
   - `App.tsx`：主应用逻辑：
      - 管理当前猫咪、聊天记录、语音识别/合成状态。
      - 调用 `LiveSessionManager` 与 `sendTextMessage` 完成 LLM + TTS 请求。
      - 右下角悬浮按钮（音量、唱歌、投喂）。
   - `constants.ts`：
      - `BLACK_CAT_CONFIG` / `WHITE_CAT_CONFIG`：黑白双猫的配置（名字、性别、主题色、系统提示词）。
   - `types.ts`：类型定义，如 `CatConfig`、`ChatMessage`、`CatType` 等。
   - `config.ts`：
      - `initializeAppConfig()`：应用启动时调用的全局配置入口。
      - `configForXunfeiTTS()` 等：统一配置 LLM / TTS / 代理等。
      - `createCustomSpeechService()`：向 `App.tsx` 提供的 ASR 工厂函数。
   - `electron.cjs`：Electron 主进程，创建窗口并在生产环境中加载打包后的 `dist/index.html`。
   - `vite.config.ts`：Vite 配置（端口、别名、环境变量注入等）。

- `components/`
   - `CatAvatar.tsx`：猫咪头像组件，包含所有表情与动作：
      - 眨眼、睡觉、挥手打招呼、思考时多种动作（歪头、挠头、张望等）。
      - 眼神跟随鼠标移动。
      - 点击猫咪时的互动（兴奋动画、唤醒睡眠）。
      - 使用纯 CSS + Tailwind 实现的 Garfield 风格猫咪造型。
   - `ChatBubble.tsx`：聊天记录组件，负责将 `messages` 渲染成气泡对话。

- `services/`
   - `geminiService.ts`：
      - 定义 `LiveSessionManager` 处理流式对话/音频。
      - 封装 `sendTextMessage` 统一发送文本+历史记录给大模型，并返回文字+语音。
      - 包含对 DeepSeek / OpenAI 兼容接口的配置入口和自定义 TTS 实现。
   - `speechRecognition.ts`：
      - `BrowserSpeechService`：使用浏览器原生 Web Speech API（备用方案）。
      - `RestApiSpeechService`：可扩展的 REST ASR。
      - `XunfeiSpeechService`：对接讯飞 WebSocket ASR，是当前的默认外部语音识别方案。
   - `audioUtils.ts`：
      - `decodeBase64`、`decodeAudioData` 等工具函数，用于 TTS 返回音频的解码。

- 其他
   - `dist/`：Vite 构建输出目录（网页版）。
   - `release/`：electron-builder 打包输出目录：
      - `Garfield Chat Setup 1.0.0.exe`：Windows 安装包。
      - `win-unpacked/`：免安装的可执行目录（直接运行 `Garfield Chat.exe`）。

---

4. 项目特点
------------

### 4.1 角色化双猫咪设计

- 黑猫 **Kuro**：
   - 暗色主题，深色男声。
   - 系统提示词偏冷酷、吐槽风，但仍然关心用户。

- 白猫 **Shiro**：
   - 粉色主题，柔和女声。
   - 系统提示词偏可爱、活泼、撒娇风格。

不同角色使用不同系统提示词与语音配置，能在同一应用内体验两种聊天人格。

### 4.2 完整的语音交互体验

- 语音输入：
   - 按住麦克风 → 录音；松开 → 发送结束帧，继续等待完整识别结果。
   - 最终识别文本填入输入框，由用户确认后再点击发送。
   - 避免了识别不完整或错误时自动发送的情况。

- 语音输出：
   - 文本发送后，统一通过 `sendTextMessage` 路径请求 LLM。
   - 返回同时包含：
      - `responseText`：模型的文字回复。
      - `audioData`：对应的语音 Base64 数据。
   - 前端流程：
      1. 等待音频生成完成；
      2. 将文字消息追加到聊天记录；
      3. 解码音频并顺序播放，保证“文字+语音”同步体验。

### 4.3 丰富的猫咪动作与动画

- 眨眼：每 3~5 秒随机眨眼一次，更贴近真实猫咪。
- 睡觉：
   - 超过 10 秒没有交互（说话/聆听/思考）自动进入睡眠状态。
   - 睡着后眼睛闭合、呼吸动画停止，并显示 “Zzz” 浮动文字。
   - 点击猫咪可唤醒，并有一段“兴奋抖动”动画。
- 思考时的多种动作：
   - 歪头、挠头、四处张望等，会在“Thinking...” 阶段循环切换。
   - 瞳孔位置会随着动作变化，表现更自然。
- 尾巴摇摆、身体呼吸等基础动画由 `index.html` 中的 CSS 动画实现。

### 4.4 右下角悬浮操作区

- **音量控制**：
   - 按钮点击弹出音量滑块（0~100%）。
   - 使用 `AudioContext` 的 `GainNode` 控制整体播放音量。
   - 当猫咪正在说话时，音量按钮和滑块会被禁用，避免播放中的突变。

- **唱歌按钮**：
   - 点击后向大模型发送类似提示词：
      - “请你作为一只可爱的猫咪唱一首关于晒太阳的歌”。
   - 模型返回猫咪语气的“歌词”文本 + 对应语音。
   - 文本以模型消息形式加入对话，并同步播放 TTS 语音。

- **投喂按钮（小鱼干）**：
   - 点击后向大模型发送提示词：
      - “主人给你投喂了美味的小鱼干，请表达你的感谢之情”。
   - 模型生成个性化感谢回复 + 语音播放。
   - 同时触发小鱼干掉落动画：多条 🐟 从屏幕顶部依次落下并旋转。

### 4.5 桌面应用支持

- 使用 Electron 将整个 React + Vite 应用打包为 Windows 桌面软件：
   - 主进程文件：`electron.cjs`。
   - 打包工具：`electron-builder`，配置位于 `package.json` 的 `build` 字段。

- 打包结果：
   - 安装包：`release/Garfield Chat Setup 1.0.0.exe`。
   - 免安装版：`release/win-unpacked/Garfield Chat.exe`。

---

5. 运行与打包说明
------------------

### 5.1 安装依赖

```powershell
$env:Path += ";C:\Program Files\nodejs"
npm install
```

### 5.2 开发模式运行（网页）

```powershell
npm run dev
```

Vite 会自动选择空闲端口（如 `http://localhost:3002/`）。

### 5.3 生产构建（仅网页）

```powershell
npm run build
```

构建产物输出到 `dist/` 目录。

### 5.4 打包 Windows 桌面应用

```powershell
$env:Path += ";C:\Program Files\nodejs"
npm run electron:build
```

打包完成后：

- 安装包：`release/Garfield Chat Setup 1.0.0.exe`。
- 免安装：`release/win-unpacked/Garfield Chat.exe`。

首次运行时可能会触发 Windows SmartScreen 提示，可选择“更多信息 → 仍要运行”。

---

6. 关键交互流程
----------------

### 6.1 文本对话流程

1. 用户在输入框中输入文本，点击发送按钮。
2. `App.tsx` 调用 `sendTextMessage(text, currentCat, messages)`：
    - 将对话历史 `messages` 与当前输入一起发送到后端 LLM。
3. `geminiService.ts` 负责实际 HTTP / WebSocket 调用，并返回：
    - `text`：模型文字回复。
    - `audioData`：对应的 TTS 语音。
4. 前端将 `text` 追加为模型消息，并通过 `audioUtils` 解码 `audioData` 并调用 `playAudioBuffer` 播放。

### 6.2 语音输入流程

1. 用户按住底部麦克风按钮：
    - 调用 `XunfeiSpeechService.start()` 开始录音，并通过 WebSocket 推流到讯飞 ASR。
2. 用户松开麦克风按钮：
    - 调用 `stop()` 发送结束帧，等待最终识别结果。
3. 最终识别文本写入输入框：
    - 用户可以编辑、确认后再点击发送按钮。

### 6.3 唱歌 / 投喂流程

1. 用户点击右下角“唱歌”或“小鱼干”按钮。
2. `App.tsx` 构造相应的自然语言提示词（不直接写死完整歌词/感谢语），并调用 `sendTextMessage`：
    - 示例提示：
       - “请你作为一只可爱的猫咪唱一首关于晒太阳的歌”。
       - “主人给你投喂了美味的小鱼干，请表达你的感谢之情”。
3. LLM 根据猫咪角色系统提示 + 历史对话 + 新提示词生成回复文本与语音。
4. 前端将回复作为模型消息显示，并播放对应语音：
    - 唱歌：消息内容是“歌词风格”的文本。
    - 投喂：消息内容是多样化的感谢语，并触发小鱼干掉落动画。

---

7. 可继续拓展的方向
--------------------

- 增加更多猫咪角色（例如灰猫、橘猫），并为每个角色配置不同的系统提示词和音色。
- 为桌面端增加托盘图标、快捷键唤起等功能，使其更像常驻助手。
- 支持对话记忆持久化（本地或云端），在重新打开应用时保留历史聊天。
- 加入设置面板，让用户可以在 UI 中直接切换 ASR/LLM/TTS 服务与参数，而无需修改 `config.ts`。

---

本项目适合作为“人机交互”课程大作业或多模态聊天助手 Demo，展示了 LLM + 语音 + 动画角色的完整闭环体验。

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ZqMsOZ60LTE6CYT_2ufik852HiHvyq_M

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

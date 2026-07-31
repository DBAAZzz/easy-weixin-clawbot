import { clamp, damp, perspective } from "./math.js";
import {
  createColorTarget,
  createProgram,
  createSphere,
  destroyColorTarget,
  getUniforms,
} from "./gl.js";
import {
  blurFragmentShader,
  compositeFragmentShader,
  fullscreenVertexShader,
  sceneFragmentShader,
  sceneVertexShader,
} from "./shaders.js";

const canvas = document.querySelector("#bubble-canvas");
const errorMessage = document.querySelector("#webgl-error");
// 场景全部渲染进 sceneTarget（它自带深度附件），默认帧缓冲上只画 composite
// 那一个全屏三角形，而且深度测试是关掉的。所以 MSAA 和深度缓冲在这里收益为
// 零：三角形没有任何几何边缘可抗锯齿，深度值也没人读。留着 antialias 只会
// 白占一块全分辨率的多重采样附件，并且每帧多做一次 resolve。
const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  depth: false,
  powerPreference: "high-performance",
});

if (!gl) {
  errorMessage.hidden = false;
  throw new Error("WebGL2 is unavailable.");
}

const sceneProgram = createProgram(gl, sceneVertexShader, sceneFragmentShader);
const blurProgram = createProgram(gl, fullscreenVertexShader, blurFragmentShader);
const compositeProgram = createProgram(
  gl,
  fullscreenVertexShader,
  compositeFragmentShader,
);
// 作为全屏常驻背景，512×512（26 万顶点）会拖垮滚动。形变的空间频率只有
// 2.66（见 shaders.js 的 displaceBody），128×128 已经足够描述这个起伏，
// 三角形数比 256×256 再少四倍。顶点数在这里尤其贵——为了算差分法线，每个
// body 顶点要跑三次 displaceBody。
const bodySphere = createSphere(gl, 128, 128);
// 五官缩放后在屏幕上只占几十像素，64×64 的话绝大多数三角形连一个像素都不到，
// 全是 quad overdraw。
const leftEyeSphere = createSphere(gl, 16, 16);
const rightEyeSphere = createSphere(gl, 16, 16);
const noseSphere = createSphere(gl, 12, 12);
const fullscreenVertexArray = gl.createVertexArray();
const projection = new Float32Array(16);

const sceneUniforms = getUniforms(gl, sceneProgram, [
  "uProjection",
  "uOffset",
  "uScale",
  "uViewRotation",
  "uObjectRotation",
  "uBodyRadius",
  "uCameraDistance",
  "uTime",
  "uPulse",
  "uBody",
  "uPress",
  "uFaceColor",
  "uAccent",
  "uAccentAmount",
]);
const blurUniforms = getUniforms(gl, blurProgram, [
  "uTexture",
  "uDirection",
]);
const compositeUniforms = getUniforms(gl, compositeProgram, [
  "uScene",
  "uBloom",
  "uResolution",
  "uTime",
  "uPress",
  "uDpr",
]);

let sceneTarget;
let blurTargetA;
let blurTargetB;
let frameHandle;
// fail() 之后置为 true：渲染目标建失败或上下文丢失，恢复时不能再重启循环。
let stopped = false;
let previousTime = performance.now();
let animationTime = 0;
let pulse = 0;
let pressAmount = 0;
let scrollAmount = 0;
// 悬停某个能力卡片时的响应：辉光染色 + 镜头微微推近。
let accentAmount = 0;
let accentTarget = 0;
let accentColor = [1, 1, 1];
let hoverPull = 0;
let hoverPullTarget = 0;
let width = 1;
let height = 1;
// 画布尺寸只在布局真正变化时测量，绝不在渲染循环里读 clientWidth——那是一次
// 强制同步布局，而 site.js 的滚动回调同帧在写 scrim 的样式，两者叠加就是每
// 帧一次整文档重排。
let pixelRatio = 1;
let pendingWidth = 1;
let pendingHeight = 1;
let resizeDirty = true;
let resizeDeadline = 0;
// 文档高度同理：scrollHeight 会触发布局，不能挂在 scroll 事件里逐次读。
let scrollRange = 0;

const lookInputGain = 1.35;
const lookInputSmoothing = 8.5;
const lookRotationSmoothing = 12;
const faceNoiseX = createPerlin1D(1);
const faceNoiseY = createPerlin1D(9);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// 作为首屏背景，泡泡要给标题让位——比原来的 4.68 再退后一些，让它读起来是个
// 角色而不是一堵墙。
const restingCameraDistance = 5.62;
// 在顶部继续上滑能把泡泡拉到的最近距离。
const closestCameraDistance = 3.6;
// 关闭动画时停在这个时刻：呼吸半径回到 1.01，脸已经出现，眼睛完全睁开。
const settledTime = 6;

const state = {
  pointerX: 0,
  pointerY: 0,
  smoothX: 0,
  smoothY: 0,
  viewYaw: 0,
  viewPitch: 0,
  hovering: false,
  pressed: false,
  cameraDistance: 0.78,
  targetCameraDistance: restingCameraDistance,
};

function createPerlin1D(seed) {
  const values = new Float32Array(4096);
  let randomSeed = seed;

  for (let index = 0; index < values.length; index++) {
    randomSeed = (randomSeed * 9301 + 49297) % 233280;
    values[index] = randomSeed / 233280;
  }

  return (input) => {
    let integer = Math.floor(Math.abs(input));
    let fraction = Math.abs(input) - integer;
    let result = 0;
    let amplitude = 0.5;

    for (let octave = 0; octave < 4; octave++) {
      const eased = 0.5 * (1 - Math.cos(fraction * Math.PI));
      const first = values[integer & 4095];
      const second = values[(integer + 1) & 4095];
      result += (first + eased * (second - first)) * amplitude;
      amplitude *= 0.5;
      integer <<= 1;
      fraction *= 2;

      if (fraction >= 1) {
        integer++;
        fraction--;
      }
    }

    // 四个倍频的振幅和是 0.9375，不归一化的话结果均值偏低，脸部漂移会
    // 一直往左下偏。
    return result / 0.9375;
  };
}

// 停掉渲染循环并把原因显示出来。渲染目标是在 applyResize() 里建的，建失败时
// 不报出来的话画面只会静止在最后一帧，看不出发生了什么。
function fail(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  stopped = true;
  cancelAnimationFrame(frameHandle);
  frameHandle = 0;
}

// 按像素总量而不是按 DPR 封顶。高分屏上 DPR 2 会让 scene 和 composite 两个
// 全分辨率 pass 各处理一千多万像素，而画面最终形态是模糊 + 噪点 + 抖动网点，
// 降采样根本看不出来。
// 五百万像素 ≈ 2560×1950：手机和普通笔记本都在预算内，跑原生密度；5K 屏会被
// 压到 1.17 倍左右，省掉三分之二的像素。
const pixelBudget = 5e6;
// 但绝不低于 1：再省也不能让画布比 CSS 分辨率还粗，那是能直接看出来的糊。
const minPixelRatio = 1;

// 只记录目标尺寸，真正的重建推迟到渲染循环里做：拖动窗口时布局每帧都在变，
// 立即重建的话三张渲染目标会被反复销毁分配。
function requestResize(immediate) {
  const raw = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = Math.max(1, canvas.clientWidth);
  const cssHeight = Math.max(1, canvas.clientHeight);
  const area = cssWidth * cssHeight * raw * raw;
  const scaled = area > pixelBudget ? raw * Math.sqrt(pixelBudget / area) : raw;
  const ratio = clamp(scaled, Math.min(raw, minPixelRatio), raw);

  pixelRatio = ratio;
  pendingWidth = Math.max(1, Math.round(cssWidth * ratio));
  pendingHeight = Math.max(1, Math.round(cssHeight * ratio));
  resizeDirty = true;
  resizeDeadline = immediate ? 0 : performance.now() + 120;
  startLoop();
}

// 在 ResizeObserver 回调里读 scrollHeight 是安全的：那时布局刚算完，不会再
// 触发一次重排。挂在 scroll 事件里逐次读才是问题。
function measureScrollRange() {
  scrollRange = document.documentElement.scrollHeight - window.innerHeight;
  updateScrollAmount();
  // 文档变高会改变 scrollAmount，进而改变镜头距离，停机状态下必须唤醒。
  startLoop();
}

function updateScrollAmount() {
  scrollAmount = scrollRange > 0 ? clamp(window.scrollY / scrollRange, 0, 1) : 0;
}

function applyResize() {
  resizeDirty = false;

  if (canvas.width === pendingWidth && canvas.height === pendingHeight) return true;

  width = pendingWidth;
  height = pendingHeight;
  canvas.width = width;
  canvas.height = height;
  perspective(projection, (36 * Math.PI) / 180, width / height, 0.1, 30);

  destroyColorTarget(gl, sceneTarget);
  destroyColorTarget(gl, blurTargetA);
  destroyColorTarget(gl, blurTargetB);

  const blurWidth = Math.max(1, Math.round(width / 4));
  const blurHeight = Math.max(1, Math.round(height / 4));

  try {
    sceneTarget = createColorTarget(gl, width, height, true);
    blurTargetA = createColorTarget(gl, blurWidth, blurHeight);
    blurTargetB = createColorTarget(gl, blurWidth, blurHeight);
  } catch (error) {
    fail(`无法创建渲染缓冲：${error.message}`);
    return false;
  }

  return true;
}

function setSceneObject({
  offset,
  scale,
  mesh = leftEyeSphere,
  body = false,
  faceColor = [1, 1, 1],
}) {
  gl.bindVertexArray(mesh.vertexArray);
  gl.uniform3fv(sceneUniforms.uOffset, offset);
  gl.uniform3fv(sceneUniforms.uScale, scale);
  gl.uniform1i(sceneUniforms.uBody, body ? 1 : 0);
  gl.uniform3fv(sceneUniforms.uFaceColor, faceColor);
  gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
}

function renderScene(time) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer);
  gl.viewport(0, 0, sceneTarget.width, sceneTarget.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  gl.useProgram(sceneProgram);
  gl.uniformMatrix4fv(sceneUniforms.uProjection, false, projection);
  gl.uniform1f(sceneUniforms.uCameraDistance, state.cameraDistance);
  gl.uniform1f(sceneUniforms.uTime, time);
  gl.uniform1f(sceneUniforms.uPulse, pulse);
  gl.uniform1f(sceneUniforms.uPress, pressAmount);
  gl.uniform3fv(sceneUniforms.uAccent, accentColor);
  gl.uniform1f(sceneUniforms.uAccentAmount, accentAmount);
  gl.uniform2f(
    sceneUniforms.uViewRotation,
    state.viewPitch,
    state.viewYaw,
  );

  const degreesToRadians = Math.PI / 180;
  const bodyRadius = 1.01 + Math.sin(time * Math.PI) * 0.05;
  gl.uniform1f(sceneUniforms.uBodyRadius, bodyRadius);
  gl.uniform3f(
    sceneUniforms.uObjectRotation,
    time * 10 * degreesToRadians,
    time * 10 * degreesToRadians,
    time * 20 * degreesToRadians,
  );
  setSceneObject({
    offset: [0, -0.01, 0],
    scale: [1, 1, 1],
    mesh: bodySphere,
    body: true,
  });

  const faceDriftX = (faceNoiseX(time * 0.2) * 2 - 1) * 0.1;
  const faceDriftY = (faceNoiseY(time * 0.4) * 2 - 1) * 0.1;
  const faceDepth = bodyRadius + 0.1;

  const faceReveal = clamp((time - 0.5) / 0.42, 0, 1);
  if (faceReveal > 0) {
    // 脸只放在体表前 0.1，但顶点形变最多能把体表推出 0.4，再被自转转到
    // 正面，五官会被身体周期性吞掉（12 秒里约有六分之一的帧）。脸本来就
    // 是不跟随自转的独立分支，所以在这里清一次深度让它始终压在最前，比
    // 把 faceDepth 抬高更稳，也不会改变五官的透视大小。
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const blinkTriangle = Math.abs(((time % 1) * 2) - 1);
    const blinkQuartOut = 1 - (1 - blinkTriangle) ** 4;
    const eyeY = 0.08 * (0.2 + blinkQuartOut * 1.35);

    gl.uniform3f(sceneUniforms.uObjectRotation, 0, 0, 0);
    setSceneObject({
      offset: [-0.1648 + faceDriftX, faceDriftY, faceDepth],
      scale: [0.08 * faceReveal, eyeY * faceReveal, 0.024],
      mesh: leftEyeSphere,
    });
    setSceneObject({
      offset: [0.1648 + faceDriftX, faceDriftY, faceDepth],
      scale: [0.08 * faceReveal, eyeY * faceReveal, 0.024],
      mesh: rightEyeSphere,
    });
    setSceneObject({
      offset: [faceDriftX, -0.155 + faceDriftY, faceDepth],
      scale: [0.0256 * faceReveal, 0.0144 * faceReveal, 0.0128],
      mesh: noseSphere,
    });
  }

  gl.bindVertexArray(null);
}

function renderBlur(source, target, x, y) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, target.width, target.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(blurProgram);
  gl.bindVertexArray(fullscreenVertexArray);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source.texture);
  gl.uniform1i(blurUniforms.uTexture, 0);
  gl.uniform2f(blurUniforms.uDirection, x / target.width, y / target.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function renderComposite(time) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(compositeProgram);
  gl.bindVertexArray(fullscreenVertexArray);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneTarget.texture);
  gl.uniform1i(compositeUniforms.uScene, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, blurTargetB.texture);
  gl.uniform1i(compositeUniforms.uBloom, 1);

  gl.uniform2f(compositeUniforms.uResolution, width, height);
  gl.uniform1f(compositeUniforms.uTime, time);
  gl.uniform1f(compositeUniforms.uPress, pressAmount);
  // 扫描线在 shader 里按设备像素排布，需要知道一个 CSS 像素有多少设备像素。
  gl.uniform1f(compositeUniforms.uDpr, pixelRatio);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

// 开场的拉远运动，叠加滚动进度带来的后退。往下滚时泡泡退远、让位给内容。
function targetCameraDistance() {
  const introDistance = 4.68 - 3.93 * Math.exp(-animationTime * 0.87);
  return (
    introDistance +
    (state.targetCameraDistance - 4.68) +
    scrollAmount * 2.4 -
    hoverPull
  );
}

function update(deltaTime) {
  const pointerTargetX = state.hovering ? state.pointerX : 0;
  const pointerTargetY = state.hovering ? state.pointerY : 0;

  state.smoothX = damp(
    state.smoothX,
    pointerTargetX,
    lookInputSmoothing,
    deltaTime,
  );
  state.smoothY = damp(
    state.smoothY,
    pointerTargetY,
    lookInputSmoothing,
    deltaTime,
  );

  const degreesToRadians = Math.PI / 180;
  const amplifiedX = clamp(state.smoothX * lookInputGain, -1, 1);
  const amplifiedY = clamp(state.smoothY * lookInputGain, -1, 1);
  const targetYaw =
    clamp(Math.round(amplifiedX * 10) * 2, -20, 20) *
    degreesToRadians;
  const targetPitch =
    clamp(Math.round(amplifiedY * 10) * -2, -20, 20) *
    degreesToRadians;
  state.viewYaw = damp(
    state.viewYaw,
    targetYaw,
    lookRotationSmoothing,
    deltaTime,
  );
  state.viewPitch = damp(
    state.viewPitch,
    targetPitch,
    lookRotationSmoothing,
    deltaTime,
  );

  const cameraTarget = targetCameraDistance();
  const pressTarget = state.pressed ? 1 : 0;

  state.cameraDistance = damp(
    state.cameraDistance,
    cameraTarget,
    11,
    deltaTime,
  );
  pressAmount = damp(pressAmount, pressTarget, 8.5, deltaTime);
  accentAmount = damp(accentAmount, accentTarget, 7, deltaTime);
  hoverPull = damp(hoverPull, hoverPullTarget, 6, deltaTime);
  pulse = damp(pulse, 0, 3.8, deltaTime);

  // 所有阻尼量离各自目标还有多远。关掉动态效果后，这个值归零就意味着后面
  // 每一帧都会和当前帧完全一样，可以停机。
  return Math.max(
    Math.abs(state.smoothX - pointerTargetX),
    Math.abs(state.smoothY - pointerTargetY),
    Math.abs(state.viewYaw - targetYaw),
    Math.abs(state.viewPitch - targetPitch),
    Math.abs(state.cameraDistance - cameraTarget),
    Math.abs(pressAmount - pressTarget),
    Math.abs(accentAmount - accentTarget),
    Math.abs(hoverPull - hoverPullTarget),
    Math.abs(pulse),
  );
}

function frame(now) {
  if (resizeDirty && now >= resizeDeadline && !applyResize()) return;

  const deltaTime = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;

  if (!reducedMotion.matches) animationTime += deltaTime;

  const residual = update(deltaTime);
  renderScene(animationTime);
  renderBlur(sceneTarget, blurTargetA, 1, 0);
  renderBlur(blurTargetA, blurTargetB, 0, 1);
  renderComposite(animationTime);

  // 关掉动态效果后时间是冻结的，阻尼量一收敛，继续跑就是在重画同一张图。
  // 停在这里，任何输入都会经 startLoop() 把循环唤回来。
  if (reducedMotion.matches && residual < 1e-4) {
    frameHandle = 0;
    return;
  }

  frameHandle = requestAnimationFrame(frame);
}

function updatePointer(event) {
  // canvas 是 position: fixed; inset: 0，尺寸恒等于视口。用 innerWidth/
  // innerHeight 代替 getBoundingClientRect()，省掉每次指针移动的强制布局。
  state.pointerX = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
  state.pointerY = clamp(1 - (event.clientY / window.innerHeight) * 2, -1, 1);
}

window.addEventListener("pointerenter", (event) => {
  state.hovering = true;
  updatePointer(event);
  startLoop();
});

window.addEventListener("pointermove", (event) => {
  state.hovering = true;
  updatePointer(event);
  startLoop();
});

window.addEventListener("pointerleave", () => {
  state.hovering = false;
  state.pressed = false;
  startLoop();
});

canvas.addEventListener("pointerdown", (event) => {
  state.hovering = true;
  updatePointer(event);
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  state.pressed = true;
  startLoop();
});

canvas.addEventListener("pointerup", (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  state.pressed = false;
  startLoop();
});

canvas.addEventListener("pointercancel", () => {
  state.pressed = false;
  startLoop();
});

// 页面已经到顶、还在继续往上滑时，多出来的滚动量交给泡泡做拉近；其余情况
// 一律放行给页面滚动。往下滑时先把拉近还原，回到静止距离后才松手让页面动，
// 否则会出现「页面在滚、泡泡还怼在脸上」的状态。
function handleWheel(event) {
  const pullingCloser = event.deltaY < 0;
  const stillZoomed =
    state.targetCameraDistance < restingCameraDistance - 0.001;

  if (!pullingCloser && !stillZoomed) return;

  event.preventDefault();
  state.targetCameraDistance = clamp(
    state.targetCameraDistance + event.deltaY * 0.0022,
    closestCameraDistance,
    restingCameraDistance,
  );
  startLoop();
}

// 这个监听必须是 non-passive（要 preventDefault），而常驻一个 non-passive 的
// wheel 监听会让浏览器无法走合成器的快速滚动路径——每个滚轮事件都得排队等
// 主线程，而主线程正忙着渲染。在处理函数里提前 return 救不了，浏览器并不知道
// 你会 return。所以只在页面确实处于顶端时才把它挂上去。
let wheelAttached = false;

function syncWheelListener() {
  const needed = window.scrollY <= 0;
  if (needed === wheelAttached) return;

  if (needed) {
    window.addEventListener("wheel", handleWheel, { passive: false });
  } else {
    window.removeEventListener("wheel", handleWheel);
  }

  wheelAttached = needed;
}

window.addEventListener(
  "scroll",
  () => {
    updateScrollAmount();
    syncWheelListener();
    startLoop();
  },
  { passive: true },
);

// 挂在 window 上而不是 canvas 上：canvas 虽然有 tabindex，但页面载入时焦点
// 在 body，绑在 canvas 上会导致必须先点一下画布快捷键才生效。
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key.toLowerCase() === "r") {
    state.cameraDistance = 0.78;
    state.targetCameraDistance = restingCameraDistance;
    state.viewYaw = 0;
    state.viewPitch = 0;
    state.smoothX = 0;
    state.smoothY = 0;
    animationTime = 0;
    pulse = 1;
    applyMotionPreference();
  }

  if (event.key.toLowerCase() === "l") {
    pulse = 1;
  }

  startLoop();
});

// 开启「减少动态效果」时把时间停在一个安定的姿势，指针跟随和缩放这些由
// 用户主动触发的反馈仍然保留。
function applyMotionPreference() {
  if (!reducedMotion.matches) return;
  animationTime = settledTime;
  state.cameraDistance = targetCameraDistance();
}

reducedMotion.addEventListener("change", () => {
  applyMotionPreference();
  // 从「减少动态」切回正常时循环可能正停着，必须唤醒。
  startLoop();
});
applyMotionPreference();

// 上下文丢失后所有 GL 对象都失效，这里不做重建，明确告诉用户刷新即可，
// 否则渲染循环会一直空转报错。
canvas.addEventListener("webglcontextlost", () => {
  fail("图形上下文已丢失，请刷新页面。");
});

// site.js 在悬停/聚焦能力卡片时派发；颜色是 CSS 解析后的 rgb() 字符串。
window.addEventListener("bubble:accent", (event) => {
  const { active, color } = event.detail;
  accentTarget = active ? 1 : 0;
  hoverPullTarget = active ? 0.42 : 0;

  startLoop();

  if (!active || !color) return;
  const channels = color.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return;
  accentColor = channels.slice(0, 3).map((v) => Number(v) / 255);
});

document.addEventListener("visibilitychange", () => {
  previousTime = performance.now();
});

function startLoop() {
  // fail() 会把 frameHandle 置 0 并立起 stopped，那种情况不该被恢复重启。
  if (stopped || frameHandle) return;
  previousTime = performance.now();
  frameHandle = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(frameHandle);
  frameHandle = 0;
}

// 画布尺寸和文档高度都由观察器推送，渲染循环里一次布局查询都不做。
if ("ResizeObserver" in window) {
  new ResizeObserver(() => requestResize(false)).observe(canvas);
  new ResizeObserver(measureScrollRange).observe(document.documentElement);
}

// window.resize 兜住 ResizeObserver 看不见的那部分：缩放页面、把窗口拖到另一
// 块不同 DPR 的显示器上，CSS 尺寸可能没变但设备像素密度变了。
window.addEventListener("resize", () => {
  requestResize(false);
  measureScrollRange();
});

requestResize(true);
measureScrollRange();
syncWheelListener();
startLoop();

// 离开页面时停掉循环省电，但一定要能再启回来：点外链走的是同标签页导航，
// 浏览器回退时页面从 bfcache 原样恢复，JS 状态还在、rAF 却已经被取消，
// 不在 pageshow 里重启的话泡泡就永久冻住。pagehide 也不能用 once，
// 否则第二次离开就不再停了。
window.addEventListener("pagehide", stopLoop);
window.addEventListener("pageshow", startLoop);

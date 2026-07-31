// 页面层的交互：滚动暗罩、进场动画、复制按钮。
// 泡泡本身的滚动联动在 main.js 里，两边各读各的 scrollY，不互相依赖。

const scrim = document.querySelector("#scrim");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function scrollProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

// 首屏保持通透，往下滚才压暗——文字压在动画上看不清是这套布局最大的风险。
function updateScrim() {
  const heroFade = Math.min(1, window.scrollY / (window.innerHeight * 0.75));
  scrim.style.opacity = String(heroFade * 0.92);
}

let ticking = false;
window.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateScrim();
      ticking = false;
    });
  },
  { passive: true },
);
updateScrim();

// 进场动画
const revealTargets = document.querySelectorAll(".panel, .hero > *");
if (reduceMotion.matches || !("IntersectionObserver" in window)) {
  revealTargets.forEach((node) => node.classList.add("shown"));
} else {
  revealTargets.forEach((node) => node.classList.add("reveal"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("shown");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px" },
  );

  revealTargets.forEach((node, index) => {
    node.style.transitionDelay = `${Math.min(index, 6) * 60}ms`;
    observer.observe(node);
  });
}

// 离屏暂停：CSS 动画在元素滚出视口后并不会自动停，而轨道卡片的 --spin 是
// 注册过的自定义属性，它的动画只能跑在主线程。看不见的时候还每帧重算 16 个
// 元素的 transform，等于白白和 main.js 的渲染循环抢主线程。
const pauseTargets = document.querySelectorAll("[data-pause-offscreen]");
if (pauseTargets.length && "IntersectionObserver" in window) {
  const pauseObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.toggleAttribute("data-paused", !entry.isIntersecting);
      });
    },
    // 留一屏的余量，免得刚滚进来才解冻、被看见动画从静止启动。
    { rootMargin: "50% 0px" },
  );

  pauseTargets.forEach((node) => pauseObserver.observe(node));
}

// 悬停/聚焦能力卡片时通知背景层：辉光染成这条能力的配色，镜头微微推近。
// 用自定义事件而不是全局变量，main.js 和 site.js 保持互不依赖。
function announceAccent(active, color) {
  window.dispatchEvent(
    new CustomEvent("bubble:accent", { detail: { active, color } }),
  );
}

document.querySelectorAll(".orbit-ring li").forEach((item) => {
  const node = item.querySelector(".node");
  // 从圆点的计算样式里取解析后的 rgb()，直接读 --pip 拿到的是未替换的
  // var(--red) 字面量。
  const color = getComputedStyle(node, "::before").backgroundColor;

  const enter = () => announceAccent(true, color);
  const leave = () => announceAccent(false);

  item.addEventListener("pointerenter", enter);
  item.addEventListener("pointerleave", leave);
  item.addEventListener("focusin", enter);
  item.addEventListener("focusout", leave);
});

// 终端打字：滚进视口才开始，否则动画在用户看到之前就放完了。
const termBody = document.querySelector(".term-body");
if (termBody) {
  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    // 不加 .typing，四行命令直接是完整宽度。
  } else {
    const typeObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("typing");
          typeObserver.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    typeObserver.observe(termBody);
  }
}

// 复制安装命令
document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copyTarget);
    if (!source) return;

    // 每行是一个 .line，行之间没有换行符，直接取 textContent 会连成一串。
    const lines = source.querySelectorAll(".line");
    const text = lines.length
      ? [...lines].map((line) => line.textContent.trim()).join("\n")
      : source.textContent.trim();

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "已复制";
      button.dataset.copied = "";
    } catch {
      // 非安全上下文（http://）下 Clipboard API 不可用，退回让用户自己选。
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "已选中，请按 ⌘C";
    }

    setTimeout(() => {
      button.textContent = "复制";
      delete button.dataset.copied;
    }, 2000);
  });
});

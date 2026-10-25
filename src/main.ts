import * as THREE from 'three';
import { Game } from './game/game';
import { loadArt } from './game/assets';

// 像素色板需要“原样输出”：关闭 three 的 sRGB→线性色彩管理，
// 否则材质颜色会被压暗约 3 倍，色板量化后压缩到最暗几档（实测最亮 23/255）。
THREE.ColorManagement.enabled = false;

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x0b0e12, 1);

const ASPECT = 16 / 9;

function resize(): void {
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  let w = winW;
  let h = Math.round(winW / ASPECT);
  if (h > winH) {
    h = winH;
    w = Math.round(winH * ASPECT);
  }
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  renderer.setSize(w, h, false);
}

window.addEventListener('resize', resize);
resize();

let game: Game | null = null;
let last = performance.now();
let firstFrame = true;

function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) {
    game.update(dt);
    if (firstFrame) {
      firstFrame = false;
      boot.style.display = 'none';
    }
  }
  requestAnimationFrame(loop);
}

// 先加载美术清单（缺失自动回退到程序化占位图），再启动游戏
loadArt().then((art) => {
  if (art.replaced.length > 0) {
    console.info('[art] 已替换：', art.replaced.join(', '));
  }
  game = new Game(canvas, renderer, art);
  requestAnimationFrame(loop);
});
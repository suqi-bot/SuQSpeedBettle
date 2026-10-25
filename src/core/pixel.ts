import * as THREE from 'three';
import { PALETTE } from '../game/palette';

export const INTERNAL_W = 384;
export const INTERNAL_H = 216;

/**
 * 低分辨率像素质感渲染管线（GDD §1.2.1）：
 * 1) 场景渲染到 384×216 的 RenderTarget
 * 2) 全屏 pass：最近邻放大 + Bayer 抖动 + 色板量化（32 色）
 */
export class PixelPipeline {
  readonly rt: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.rt = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    const decl = PALETTE.map(
      (c, i) => `pal[${i}] = vec3(${(c[0] / 255).toFixed(5)}, ${(c[1] / 255).toFixed(5)}, ${(c[2] / 255).toFixed(5)});`,
    ).join('\n      ');

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uQuantize: { value: new URLSearchParams(location.search).has('noquant') ? 0 : 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uQuantize;
        varying vec2 vUv;

        float bayer4(vec2 p) {
          int x = int(mod(p.x, 4.0));
          int y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          float m[16];
          m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
          m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
          m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
          m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
          for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0 - 0.5; }
          return 0.0;
        }

        void main() {
          vec3 pal[${PALETTE.length}];
          ${decl}

          vec3 c = texture2D(tDiffuse, vUv).rgb;
          if (uQuantize < 0.5) {
            gl_FragColor = vec4(c, 1.0);
            return;
          }
          float d = bayer4(gl_FragCoord.xy) * 0.055;
          c = clamp(c + d, 0.0, 1.0);

          float best = 1e9;
          vec3 outC = c;
          for (int i = 0; i < ${PALETTE.length}; i++) {
            vec3 df = c - pal[i];
            float dist = dot(df, df);
            if (dist < best) { best = dist; outC = pal[i]; }
          }
          gl_FragColor = vec4(outC, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }
}

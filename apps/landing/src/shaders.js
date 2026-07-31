export const sceneVertexShader = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uProjection;
uniform vec3 uOffset;
uniform vec3 uScale;
uniform vec2 uViewRotation;
uniform vec3 uObjectRotation;
uniform float uBodyRadius;
uniform float uCameraDistance;
uniform float uTime;
uniform float uPulse;
uniform int uBody;

out vec3 vNormal;
out vec3 vProjectionLocal;
out vec3 vWorld;

mat3 rotateX(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat3(1, 0, 0, 0, c, s, 0, -s, c);
}

mat3 rotateY(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat3(c, 0, -s, 0, 1, 0, s, 0, c);
}

mat3 rotateZ(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat3(c, s, 0, -s, c, 0, 0, 0, 1);
}

// 上下两组反向 XYZ 形变，外加弹性脉冲的挤压。输入是单位球面上的点。
vec3 displaceBody(vec3 unitPosition) {
  vec3 p = unitPosition * uBodyRadius;

  float upperDistance = distance(vec3(0.0, 1.3, 0.0), p);
  float upperArea = 1.0 - smoothstep(0.0, 2.82, upperDistance);
  float upperWobble =
    sin(uTime * 10.0 + (p.x + p.z) * 2.66) *
    0.2 *
    upperArea;
  p += vec3(upperWobble);

  float lowerDistance = distance(vec3(0.0, -1.3, 0.0), p);
  float lowerArea = 1.0 - smoothstep(0.0, 2.82, lowerDistance);
  float lowerWobble =
    sin(-uTime * 10.0 + (p.x + p.z) * 2.66) *
    0.2 *
    lowerArea;
  p += vec3(lowerWobble);

  return p * (1.0 + uPulse * 0.025 * vec3(1.0, -0.55, 1.0));
}

void main() {
  vec3 local = aPosition;
  vec3 normal = aNormal;
  vec3 projectionLocal = local;

  if (uBody == 1) {
    vec3 unitPosition = normalize(aPosition);
    projectionLocal = unitPosition * uBodyRadius;
    local = displaceBody(unitPosition);

    // 形变最大能推动顶点 0.4，法线必须跟着重算，否则高光和 Fresnel 不会
    // 随起伏移动。解析雅可比展开太长，这里沿球面取两个正交切向做差分。
    vec3 reference = abs(unitPosition.y) < 0.99
      ? vec3(0.0, 1.0, 0.0)
      : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(reference, unitPosition));
    vec3 bitangent = cross(unitPosition, tangent);
    vec3 alongTangent =
      displaceBody(normalize(unitPosition + tangent * 3e-3)) - local;
    vec3 alongBitangent =
      displaceBody(normalize(unitPosition + bitangent * 3e-3)) - local;

    // cross(tangent, bitangent) == unitPosition，所以叉乘方向与球面法线同向。
    vec3 deformed = cross(alongTangent, alongBitangent);
    normal = length(deformed) > 1e-9 ? normalize(deformed) : unitPosition;

    // 形变在极值处会自折叠（雅可比行列式过零），那里差分法线会翻面，
    // 翻回朝外可以避免出现黑斑。
    if (dot(normal, unitPosition) < 0.0) normal = -normal;
  }

  vec3 position = local * uScale + uOffset;
  mat3 objectRotation =
    rotateX(uObjectRotation.x) *
    rotateY(uObjectRotation.y) *
    rotateZ(uObjectRotation.z);
  mat3 viewRotation =
    rotateX(uViewRotation.x) *
    rotateY(uViewRotation.y);

  position = objectRotation * position;
  normal = normalize(objectRotation * normal);
  position = viewRotation * position;
  normal = normalize(viewRotation * normal);

  vProjectionLocal = projectionLocal;
  vWorld = position;
  vNormal = normal;

  position.z -= uCameraDistance;
  gl_Position = uProjection * vec4(position, 1.0);
}
`;

export const sceneFragmentShader = `#version 300 es
precision highp float;
precision highp int;

in vec3 vNormal;
in vec3 vProjectionLocal;
in vec3 vWorld;

uniform float uTime;
uniform float uPress;
uniform float uCameraDistance;
uniform int uBody;
uniform vec3 uFaceColor;
uniform vec3 uAccent;
uniform float uAccentAmount;

out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float originalDitherValue(vec2 pixelPosition) {
  int x = int(mod(floor(pixelPosition.x), 4.0));
  int y = int(mod(floor(pixelPosition.y), 4.0));
  int index = x * 4 + y;

  const float values[16] = float[](
    1.0, 13.0, 4.0, 16.0,
    9.0, 5.0, 12.0, 8.0,
    3.0, 15.0, 2.0, 14.0,
    11.0, 7.0, 10.0, 6.0
  );
  return values[index];
}

// 红为主 + 三个搭配色。原版是四档（琥珀→玫瑰→紫→青），这里扩成五档，
// 好让主红独占中间最宽的一段；配色沿色相环排开，相邻两档的色相跨度都不大，
// 混出来不会发灰。
vec3 projectedGradient(float field) {
  vec3 amberGold = vec3(0.9098, 0.6392, 0.2392);   // #E8A33D 琥珀金
  vec3 primaryRed = vec3(0.8902, 0.2863, 0.2863);  // #E34949 主红（参考形象取色）
  vec3 primaryRedLit = vec3(0.9020, 0.3098, 0.2941); // #E64F4B 主红提亮档
  vec3 rosePink = vec3(0.9098, 0.3843, 0.6078);    // #E8629B 玫粉
  vec3 teal = vec3(0.1843, 0.6588, 0.5804);        // #2FA894 青绿

  // 青绿是唯一的冷色，单独隔离在左端，否则它和玫粉挨在一起会连成一大片
  // 冷色区，转到正面时红就完全被压住了。右端留给两个暖色配色。
  if (field <= 0.10) {
    return teal;
  }
  if (field <= 0.30) {
    return mix(teal, primaryRed, smoothstep(0.10, 0.30, field));
  }
  if (field <= 0.78) {
    return mix(primaryRed, primaryRedLit, smoothstep(0.30, 0.78, field));
  }
  if (field <= 0.90) {
    return mix(primaryRedLit, rosePink, smoothstep(0.78, 0.90, field));
  }
  return mix(rosePink, amberGold, smoothstep(0.90, 1.0, field));
}

void main() {
  if (uBody == 0) {
    float faceRim = pow(1.0 - max(vNormal.z, 0.0), 4.0);
    vec3 edge = mix(
      vec3(0.55, 0.10, 0.14),
      vec3(1.0, 0.42, 0.30),
      step(0.0, vWorld.x)
    );
    outColor = vec4(uFaceColor + edge * faceRim * 0.045, 1.0);
    return;
  }

  vec3 n = normalize(vNormal);
  vec3 cameraPosition = vec3(0.0, 0.0, uCameraDistance);
  vec3 viewDirection = normalize(cameraPosition - vWorld);

  // vProjectionLocal.x 只有 ±1.06，原版除以 4.36 会把 field 压在 [0.26, 0.74]，
  // 两端的色标永远渲染不到。除以 2.2 才能让 field 铺满 [0.02, 0.98]。
  float field = clamp(vProjectionLocal.x / 2.2 + 0.5, 0.0, 1.0);
  vec3 base = projectedGradient(field);

  // Original scene: a 35.36-intensity spotlight at (1, 3, 1), followed by
  // the Phong material's broad Blinn highlight.
  vec3 lightDirection = normalize(vec3(2.0, 6.0, 2.0) - vWorld);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float diffuse = max(dot(n, lightDirection), 0.0);
  float specular = pow(max(dot(n, halfDirection), 0.0), 2.26) * 0.209;

  // TextureProjection is Lighten at amount 1, so the gradient is the minimum
  // surface brightness and the Phong result can only lift it.
  vec3 phongColor = base * (0.86 + diffuse * 0.42) + vec3(specular) * 0.35;
  vec3 color = max(phongColor, base);

  // Both Cables Fresnel implementations use the camera-space half-vector
  // formula below (rather than the usual 1-N·V approximation).
  vec3 cameraDirection = normalize(vWorld - cameraPosition);
  vec3 fresnelHalf = normalize(n + cameraDirection + vec3(1e-6));
  float fresnelProduct = max(dot(fresnelHalf, cameraDirection), 0.0);

  // Phong Fresnel: cyan, intensity 1, width 17.98, exponent 9.61.
  float cyanFresnel =
    5.0 * pow(fresnelProduct, 9.61) * 17.98;
  color += vec3(0.045, 0.030, 0.028) * cyanFresnel;
  color = clamp(color, 0.0, 1.0);

  // Separate FresnelGlow modifier: yellow, intensity 2.39, exponent 6.97.
  float yellowFresnel =
    5.0 * pow(fresnelProduct, 6.97) * 2.39;
  // 悬停某个能力时，把这道边缘辉光染成它的配色。只动辉光、不动本体渐变，
  // 红色主调不会被带跑。
  vec3 glowTint = mix(vec3(0.030, 0.012, 0.010), uAccent * 0.075, uAccentAmount);
  color += glowTint * yellowFresnel;
  // 原版这里是 bgr 通道对调，专为粉紫调设计；红色套上去会变浑浊的紫粉，
  // 改成按下去颜色加深，留在红色族里。
  color = mix(
    color,
    color * vec3(0.78, 0.52, 0.52),
    uPress * 0.55
  );

  // 逐像素数码噪点。原版用 Overlay 叠加，会把低于 0.5 的通道压向 0；
  // 红色的 G、B 都在死区里，所以改成乘性，颗粒感一样但色相不变。
  float printNoise = hash21(floor(gl_FragCoord.xy));
  color *= mix(0.90, 1.10, printNoise);

  // 4x4 有序抖动网点。原版阈值 0.753 是为明度 ~0.8 的粉紫调定的，
  // 而参考红明度只有 0.415，乘上抖动偏移后最高到 0.64，永远够不着，
  // 网点会整片消失。阈值挪到红色的明度区间中点，密度才回得来。
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float adjustment = (originalDitherValue(gl_FragCoord.xy) - 8.0) / 14.65;
  float ditherBit = step(0.43, luminance * (1.0 + adjustment));
  color *= mix(0.74, 1.26, ditherBit);

  outColor = vec4(color, 1.0);
}
`;

export const fullscreenVertexShader = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const blurFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTexture;
uniform vec2 uDirection;

out vec4 outColor;

void main() {
  vec4 color = vec4(0.0);
  float total = 0.0;

  for (int i = -6; i <= 6; i++) {
    float x = float(i);
    float weight = exp(-(x * x) / 14.0);
    color += texture(uTexture, vUv + uDirection * x * 1.85) * weight;
    total += weight;
  }

  outColor = color / total;
}
`;

export const compositeFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPress;
uniform float uDpr;

out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

vec3 background(vec2 uv) {
  // 深墨底：不是纯黑，左右各带一点紫和蓝，下方再压暗，避免大面积死黑。
  vec3 left = vec3(0.0863, 0.0745, 0.1098);   // #16131C
  vec3 right = vec3(0.1137, 0.0863, 0.1333);  // #1D1622
  vec3 bottom = vec3(0.0549, 0.0510, 0.0784); // #0E0D14
  vec3 color = mix(left, right, smoothstep(0.0, 1.0, uv.x));
  color = mix(color, bottom, smoothstep(0.48, 1.15, uv.y) * 0.62);

  float centerGlow = exp(
    -7.0 * dot(uv - vec2(0.5, 0.48), uv - vec2(0.5, 0.48))
  );
  float curtain = sin(uv.x * 18.0 + sin(uv.y * 3.0) * 1.2) * 0.014;
  float blocks = hash21(
    floor(uv * vec2(16.0, 10.0)) +
    floor(uTime * 0.8)
  );
  float lineHash = hash21(vec2(
    floor(uv.y * 34.0),
    floor(uv.x * 4.0) + floor(uTime * 0.55)
  ));
  float horizontalGlitch = smoothstep(0.86, 1.0, lineHash) * 0.032;

  // 角色背后的一团暖红光池，把主体从深底里托出来，也是背景唯一的色源。
  color += centerGlow * vec3(0.34, 0.12, 0.13);
  color += curtain * 0.6;
  // 块噪和扫描线在浅底上几乎看不见，深底才撑得住。扫描线取身体的青绿配色。
  color += (blocks - 0.5) * 0.022;
  color += horizontalGlitch * vec3(0.18, 0.66, 0.58);
  // 深底上再压暗看不出来，按住时改成整片微微提亮，像光池被推开一下。
  color = mix(
    color,
    color * vec3(2.1, 1.5, 1.45),
    uPress * 0.45
  );
  return color;
}

void main() {
  vec2 centered = vUv - 0.5;
  float radius2 = dot(centered, centered);
  vec2 warpedUv = 0.5 + centered * (1.0 + radius2 * 0.035);
  vec2 pixel = 1.0 / uResolution;
  vec2 aberration = centered * (0.0012 + radius2 * 0.0024);

  vec4 middle = texture(uScene, warpedUv);
  vec4 redSample = texture(
    uScene,
    warpedUv + aberration + pixel * vec2(0.5, 0.0)
  );
  vec4 blueSample = texture(
    uScene,
    warpedUv - aberration - pixel * vec2(0.5, 0.0)
  );
  vec3 sceneColor = vec3(redSample.r, middle.g, blueSample.b);
  float alpha = middle.a;

  vec4 bloom = texture(uBloom, warpedUv);
  vec3 color = background(vUv);
  color = mix(color, sceneColor, alpha);

  float halo = 1.0 - alpha;
  color += bloom.rgb * halo * (1.02 + uPress * 0.12);

  vec4 cyanGlow = texture(
    uBloom,
    warpedUv - vec2(0.0045, 0.008)
  );
  vec4 pinkGlow = texture(
    uBloom,
    warpedUv + vec2(0.0035, 0.006)
  );
  float outside = 1.0 - alpha;
  // 两道错位的边缘辉光，颜色取自身体的两个配色（青绿 / 玫粉），
  // 这样光晕和主体是一套色，而不是原版那种撞色的青蓝加洋红。
  color += vec3(0.1843, 0.6588, 0.5804) * cyanGlow.a * outside * 0.20;
  color += vec3(0.9098, 0.3843, 0.6078) * pinkGlow.a * outside * 0.16;

  color = pow(max(color, 0.0), vec3(0.96));

  // 扫描线。原来是 DOM 里一层 mix-blend-mode: overlay 的全视口 fixed 覆盖层，
  // 压在每帧都在变的 canvas 上，合成器没法把它当独立层缓存，每帧都要把背景
  // 读回来做一次全屏混合。这里两条指令就够了：白线在 overlay 下对暗色底等价
  // 于按不透明度提亮，原来的 3% 白 × 0.5 不透明度正好是 1.5%。
  float scanPeriod = max(3.0 * uDpr, 1.0);
  float scanLine = step(mod(gl_FragCoord.y, scanPeriod), uDpr);
  color *= 1.0 + scanLine * 0.015;

  outColor = vec4(color, 1.0);
}
`;

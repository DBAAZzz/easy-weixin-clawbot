export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const damp = (current, target, smoothing, deltaTime) =>
  current + (target - current) * (1 - Math.exp(-smoothing * deltaTime));

export function perspective(out, fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2);
  const nf = 1 / (near - far);

  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = 2 * far * near * nf;
  out[15] = 0;

  return out;
}

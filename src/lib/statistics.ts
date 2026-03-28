/**
 * Statistical utilities for multi-run evaluation (Milestone 3).
 * No external dependencies — all math implemented inline.
 */

// ── Bootstrap Confidence Interval ────────────────────────────────────────
/**
 * Bootstrap 95% CI using percentile method.
 * @param samples  Array of numeric scores (0-100 scale)
 * @param iterations  Number of bootstrap resamples (default 2000)
 * @returns { lower, upper, mean, median, std }
 * Guard: if samples.length < 2, returns point estimate (lower = upper = value)
 */
export function bootstrapCI(
  samples: number[],
  iterations = 2000
): { lower: number; upper: number; mean: number; median: number; std: number } {
  if (samples.length === 0) {
    return { lower: 0, upper: 0, mean: 0, median: 0, std: 0 }
  }
  if (samples.length === 1) {
    const v = samples[0]
    return { lower: v, upper: v, mean: v, median: v, std: 0 }
  }

  const n = samples.length
  const mean = samples.reduce((a, b) => a + b, 0) / n

  // Population std (use n-1 for sample std)
  const variance = samples.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (n - 1)
  const std = Math.sqrt(variance)

  // Median of original samples
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]

  // Bootstrap resampling
  const bootstrapMeans: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) {
      sum += samples[Math.floor(Math.random() * n)]
    }
    bootstrapMeans[i] = sum / n
  }
  bootstrapMeans.sort((a, b) => a - b)

  const lower = bootstrapMeans[Math.floor(iterations * 0.025)]
  const upper = bootstrapMeans[Math.floor(iterations * 0.975)]

  return {
    lower:  round1(lower),
    upper:  round1(upper),
    mean:   round1(mean),
    median: round1(median),
    std:    round1(std),
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

// ── Pass@k ───────────────────────────────────────────────────────────────
/**
 * Unbiased pass@k estimator from τ-bench (Yao et al., 2024).
 * pass@k = 1 - C(n-c, k) / C(n, k)
 * where c = number of passing samples (score >= threshold).
 *
 * @param scores     Array of scores (0-100 scale)
 * @param k          Number of attempts
 * @param threshold  Pass threshold (default 70)
 */
export function passAtK(
  scores: number[],
  k: number,
  threshold = 70
): number {
  const n = scores.length
  if (n === 0 || k <= 0) return 0
  const kClamped = Math.min(k, n)
  const c = scores.filter(s => s >= threshold).length

  // If all pass or k >= n, use simple binomial
  if (c === 0) return 0
  if (c === n) return 1

  // C(n-c, k) / C(n, k) using log-space to avoid overflow
  // log C(n, k) = sum log(n-i) - log(i+1) for i in 0..k-1
  const logCnk = logBinom(n, kClamped)
  const logCnck = logBinom(n - c, kClamped)

  if (!isFinite(logCnck)) return 1  // n-c < k → C(n-c,k) = 0 → pass@k = 1

  return Math.max(0, Math.min(1, 1 - Math.exp(logCnck - logCnk)))
}

function logBinom(n: number, k: number): number {
  if (k > n) return -Infinity  // C(n,k)=0 → log=−∞
  if (k === 0 || k === n) return 0
  let result = 0
  for (let i = 0; i < k; i++) {
    result += Math.log(n - i) - Math.log(i + 1)
  }
  return result
}

// ── Welch's t-test ────────────────────────────────────────────────────────
/**
 * Two-sample Welch's t-test (unequal variances).
 * Returns true if the difference is statistically significant at α=0.05.
 * Guard: returns false if either sample has fewer than 2 elements.
 */
export function isSignificantlyDifferent(
  samplesA: number[],
  samplesB: number[]
): boolean {
  if (samplesA.length < 2 || samplesB.length < 2) return false

  const nA = samplesA.length
  const nB = samplesB.length
  const meanA = samplesA.reduce((a, b) => a + b, 0) / nA
  const meanB = samplesB.reduce((a, b) => a + b, 0) / nB

  const varA = samplesA.reduce((s, x) => s + (x - meanA) ** 2, 0) / (nA - 1)
  const varB = samplesB.reduce((s, x) => s + (x - meanB) ** 2, 0) / (nB - 1)

  if (varA + varB === 0) return false  // identical distributions

  const t = (meanA - meanB) / Math.sqrt(varA / nA + varB / nB)

  // Welch-Satterthwaite degrees of freedom
  const df = (varA / nA + varB / nB) ** 2 /
    ((varA / nA) ** 2 / (nA - 1) + (varB / nB) ** 2 / (nB - 1))

  // Two-tailed p-value via regularized incomplete beta function approximation
  // Using: p = 2 * I(df/(df+t^2), df/2, 0.5)  (Student's t CDF)
  // Approximation via erfc for large df:
  const p = tTestPValue(Math.abs(t), df)

  return p < 0.05
}

/**
 * Approximate p-value for two-tailed t-test.
 * Uses the incomplete beta function via a continued fraction approximation
 * (Abramowitz & Stegun 26.7.1) for small df, and the normal approximation for large df.
 */
function tTestPValue(t: number, df: number): number {
  if (df > 30) {
    // Normal approximation: p ≈ 2 * erfc(t / sqrt(2))
    return 2 * erfc(t / Math.SQRT2)
  }
  // Regularized incomplete beta: p = I_x(df/2, 1/2)  where x = df/(df+t^2)
  const x = df / (df + t * t)
  return incompleteBeta(x, df / 2, 0.5)
}

/** Complementary error function approximation (Abramowitz & Stegun 7.1.26) */
function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x)
  const t = 1 / (1 + 0.3275911 * x)
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return poly * Math.exp(-x * x)
}

/**
 * Regularized incomplete beta function I_x(a, b) via continued fraction.
 * Only used for small df (≤30).
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  // Use symmetry relation for numerical stability
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a)

  // Log of Beta(a,b) via log-gamma
  const logBeta = logGamma(a) + logGamma(b) - logGamma(a + b)
  // Lentz's continued fraction
  const lnx = Math.log(x)
  const ln1mx = Math.log(1 - x)
  const lnpow = a * lnx + b * ln1mx - logBeta
  const cf = betaCF(x, a, b)
  return Math.exp(lnpow) * cf / a
}

function betaCF(x: number, a: number, b: number): number {
  const MAXIT = 200
  const EPS = 3e-7
  const FPMIN = 1e-30

  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

function logGamma(x: number): number {
  // Lanczos approximation (g=7, n=9)
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const xr = x - 1
  let sum = c[0]
  for (let i = 1; i < g + 2; i++) sum += c[i] / (xr + i)
  const t = xr + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (xr + 0.5) * Math.log(t) - t + Math.log(sum)
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function waitRandom(minDelay = 2000, maxDelay = 10000): Promise<void> {
  return wait(getRandomDelay(minDelay, maxDelay));
}

export function getRandomDelay(minDelay = 2000, maxDelay = 10000): number {
  return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}
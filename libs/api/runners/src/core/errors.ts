export class RunningJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Running job not found: ${jobId}`);
    this.name = 'RunningJobNotFoundError';
  }
}

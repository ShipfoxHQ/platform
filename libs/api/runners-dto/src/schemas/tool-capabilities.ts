import {z} from 'zod';

export const runnerFeaturesSchema = z
  .object({
    renewable_git: z.boolean().optional(),
  })
  .strict();

export type RunnerFeaturesDto = z.infer<typeof runnerFeaturesSchema>;

export const runnerHarnessToolCapabilitiesSchema = z
  .object({
    tools: z.array(z.string().min(1)).superRefine((tools, ctx) => {
      const seen = new Set<string>();
      for (const [index, tool] of tools.entries()) {
        if (!seen.has(tool)) {
          seen.add(tool);
          continue;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate tool name',
          path: [index],
        });
      }
    }),
  })
  .strict();

export const runnerToolCapabilitiesSchema = z
  .object({
    features: runnerFeaturesSchema.optional(),
    harnesses: z
      .object({
        pi: runnerHarnessToolCapabilitiesSchema.optional(),
        claude: runnerHarnessToolCapabilitiesSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type RunnerHarnessToolCapabilitiesDto = z.infer<typeof runnerHarnessToolCapabilitiesSchema>;
export type RunnerToolCapabilitiesDto = z.infer<typeof runnerToolCapabilitiesSchema>;

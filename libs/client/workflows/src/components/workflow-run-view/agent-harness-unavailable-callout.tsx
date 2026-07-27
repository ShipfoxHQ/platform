import {Alert, AlertContent, AlertDescription, AlertTitle} from '@shipfox/react-ui/alert';
import type {StepError} from '#core/workflow-run.js';

export function AgentHarnessUnavailableCallout({error}: {error: StepError}) {
  return (
    <Alert variant="error" animated={false} className="px-10 py-8">
      <AlertContent>
        <AlertTitle>The runner could not start the agent for this step</AlertTitle>
        <AlertDescription>
          This step&apos;s prompt, provider, model, and thinking settings are valid. The runner
          could not start its agent before the model was called, so nothing ran. Re-running will not
          help. Ask an administrator to update the runner, then re-run the workflow.
        </AlertDescription>
        <AlertDescription className="mt-4">Runner reported: {error.message}</AlertDescription>
      </AlertContent>
    </Alert>
  );
}

import {useClientAnalytics} from '@shipfox/client-shell/runtime';
import {useEffect, useRef, useState} from 'react';
import type {ChecklistQueryState} from '#hooks/api/setup-checklist.js';

type ChecklistHost = 'panel' | 'popover';

export function useCompletionTransition(
  queryState: ChecklistQueryState,
  host: ChecklistHost,
  onCompleted?: (completed: boolean) => void,
) {
  const analytics = useClientAnalytics();
  const observedIncomplete = useRef(false);
  const completionHandled = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);

  useEffect(() => {
    if (
      queryState.baseSettled &&
      !queryState.checklist.complete &&
      queryState.checklist.openCount > 0
    ) {
      observedIncomplete.current = true;
    }

    if (!queryState.completionReady) return;

    if (!queryState.checklist.complete) {
      setShowCompletion(false);
      return;
    }

    if (!observedIncomplete.current || completionHandled.current) return;
    completionHandled.current = true;
    setShowCompletion(true);
    onCompleted?.(true);
    analytics.capture('onboarding_checklist_completed', {host});
  }, [
    analytics,
    host,
    onCompleted,
    queryState.baseSettled,
    queryState.checklist.complete,
    queryState.checklist.openCount,
    queryState.completionReady,
  ]);

  return showCompletion;
}

export function useShownAnalytics(host: ChecklistHost, visible: boolean) {
  const analytics = useClientAnalytics();
  const shown = useRef(false);

  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    analytics.capture('onboarding_checklist_shown', {host});
  }, [analytics, host, visible]);
}

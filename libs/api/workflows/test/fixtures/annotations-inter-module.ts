import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';

export const annotationsTestClient: AnnotationsInterModuleClient = {
  replaceOrRemoveAnnotation: async () => ({}),
  listAnnotationsForRunAttempt: async () => ({
    annotations: [],
    hasMore: false,
    nextCursor: null,
  }),
};

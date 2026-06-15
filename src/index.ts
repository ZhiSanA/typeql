export { buildSchema, default } from './buildSchema.ts';
export { capitalize, uncapitalize, singularize } from './case-ops/index.ts';
export { getOrCreateLoader } from './batch-loader/index.ts';
export type {
  BuildSchemaConfig,
  GeneratedData,
  GeneratedEntities,
} from './types.ts';

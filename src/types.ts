import type {
  GraphQLFieldConfig,
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLSchema,
} from 'graphql';

// ──────────────────────────────────────────────
// Core return types
// ──────────────────────────────────────────────

export interface GeneratedData {
  schema: GraphQLSchema;
  entities: GeneratedEntities;
}

export interface GeneratedEntities {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config types are dynamic
  queries: Record<string, GraphQLFieldConfig<any, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config types are dynamic
  mutations: Record<string, GraphQLFieldConfig<any, any>>;
  inputs: Record<string, GraphQLInputObjectType | GraphQLObjectType>;
  types: Record<string, GraphQLObjectType>;
  fieldResolvers: Record<
    string,
    Record<
      string,
      (
        source: unknown,
        args: unknown,
        context: unknown,
        info: unknown,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Resolver return types are dynamic
      ) => Promise<any>
    >
  >;
}

// ──────────────────────────────────────────────
// Build schema config
// ──────────────────────────────────────────────

export interface BuildSchemaConfig {
  /**
   * Restrict generated queries/mutations to specific entity classes.
   * Default: all entities registered on the DataSource.
   */
  entities?: Array<new (...args: unknown[]) => unknown>;

  /**
   * Set to false to omit the Mutation type.
   * Default: true
   */
  mutations?: boolean;

  /**
   * Custom name mapper: entity name → singular/plural pair.
   * Default uses pluralize internally:
   *   (name) => ({ singular: pluralize.singular(name), plural: pluralize.plural(name) })
   * Return `undefined` for a specific entity to fall back to the default behavior.
   */
  typeNameMapper?: (
    entityName: string,
  ) => { singular: string; plural: string } | undefined;

  /**
   * Limits depth of relation-field generation.
   * 0 = no relation fields. undefined = unlimited.
   */
  relationsDepthLimit?: number;

  /**
   * Maximum depth for relation filter generation in nested where queries.
   * Default: 2 (e.g., article -> author -> profile)
   * Set to 0 to disable nested relation filtering entirely.
   */
  maxRelationDepth?: number;
}

// ──────────────────────────────────────────────
// Resolver type helpers (public)
// ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter values vary by field type
export type Filters = Record<string, any>;

export type OrderByArgs = Record<
  string,
  { direction: 'asc' | 'desc'; priority: number }
>;

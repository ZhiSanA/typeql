import type {
  GraphQLFieldConfig,
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLSchema,
} from 'graphql';
import type { DataSource } from 'typeorm';

// ──────────────────────────────────────────────
// Core return types
// ──────────────────────────────────────────────

export interface GeneratedData {
  schema: GraphQLSchema;
  entities: GeneratedEntities;
}

export interface GeneratedEntities {
  queries: Record<string, GraphQLFieldConfig<any, any>>;
  mutations: Record<string, GraphQLFieldConfig<any, any>>;
  inputs: Record<string, GraphQLInputObjectType | GraphQLObjectType>;
  types: Record<string, GraphQLObjectType>;
  fieldResolvers: Record<
    string,
    Record<string, (source: any, args: any, context: any, info: any) => Promise<any>>
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
  entities?: Function[];

  /**
   * Set to false to omit the Mutation type.
   * Default: true
   */
  mutations?: boolean;

  /**
   * Prefixes for mutation field names.
   * Default: { insert: 'create', update: 'update', delete: 'delete' }
   */
  prefixes?: {
    insert?: string;
    update?: string;
    delete?: string;
  };

  /**
   * Suffixes for query field names.
   * Default: { list: '', single: 'Single' }
   */
  suffixes?: {
    list?: string;
    single?: string;
  };

  /**
   * Custom name mapper: entity name → singular/plural pair.
   * Return `undefined` for tables that should use default naming.
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
   * Whether to use GraphQLID for primary key columns.
   * Default: false (uses String for bigint/string PKs, Int for int PKs)
   */
  useGraphQLID?: boolean;

  /**
   * Custom column type overrides: keyed as "EntityName.columnName"
   * Maps to GraphQL scalar type name string.
   */
  columnTypeOverrides?: Record<string, string>;
}

// ──────────────────────────────────────────────
// Resolver type helpers (public)
// ──────────────────────────────────────────────

export type Filters = Record<string, any>;

export type OrderByArgs = Record<
  string,
  { direction: 'asc' | 'desc'; priority: number }
>;

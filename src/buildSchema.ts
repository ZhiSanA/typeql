import { DataSource } from 'typeorm';
import {
  type GraphQLFieldConfig,
  type GraphQLInputObjectType,
  type GraphQLObjectType,
  GraphQLSchema,
  GraphQLObjectType as GQLObjectType,
} from 'graphql';
import type { BuildSchemaConfig, GeneratedData, GeneratedEntities } from './types.ts';
import {
  extractEntityMap,
  buildRelationMap,
  generateTypes,
} from './util/builders/common.ts';
import { resolveNames } from './util/builders/names.ts';
import { generateResolvers } from './util/builders/resolvers.ts';

export type {
  BuildSchemaConfig,
  GeneratedData,
  GeneratedEntities,
} from './types.ts';

/**
 * Builds a fully-typed GraphQL schema from a TypeORM DataSource.
 *
 * @param dataSource - An initialized TypeORM DataSource instance
 * @param config - Optional configuration
 * @returns An object containing the GraphQLSchema and entity metadata
 */
export const buildSchema = (
  dataSource: DataSource,
  config: BuildSchemaConfig = {},
): GeneratedData => {
  if (!dataSource.isInitialized) {
    throw new Error('TypeQL Error: DataSource must be initialized before calling buildSchema()');
  }

  const entityMetadatas = config.entities
    ? dataSource.entityMetadatas.filter((m) => config.entities!.includes(m.target as Function))
    : dataSource.entityMetadatas;

  if (entityMetadatas.length === 0) {
    throw new Error('TypeQL Error: No entity metadatas found. Did you forget to add entities to the DataSource?');
  }

  const prefixes = { insert: 'create', update: 'update', delete: 'delete', ...config.prefixes };
  const suffixes = { list: '', single: 'Single', ...config.suffixes };
  const typeNameMapper = config.typeNameMapper;

  if (!typeNameMapper && suffixes.list === suffixes.single) {
    throw new Error(
      'TypeQL Error: List and single query suffixes cannot be the same. This would create conflicting GraphQL field names.',
    );
  }

  // Build entity and relation maps
  const entityMap: Record<string, any> = {};
  for (const meta of entityMetadatas) {
    entityMap[meta.targetName] = meta;
  }
  const relationMap = buildRelationMap(entityMetadatas);

  // Generate types
  const typeOutputs = generateTypes(entityMetadatas, entityMap, relationMap, config);

  // Generate resolvers
  const { queries, mutations, fieldResolvers } = generateResolvers(
    dataSource,
    entityMetadatas,
    relationMap,
    config,
    typeOutputs,
  );

  // Build schema
  const schemaConfig: any = {
    query: new GQLObjectType({
      name: 'Query',
      fields: queries as Record<string, GraphQLFieldConfig<any, any>>,
    }),
    types: [...Object.values(typeOutputs.inputs)],
  };

  if (config.mutations !== false) {
    schemaConfig.mutation = new GQLObjectType({
      name: 'Mutation',
      fields: mutations as Record<string, GraphQLFieldConfig<any, any>>,
    });
  }

  const schema = new GraphQLSchema(schemaConfig);

  return {
    schema,
    entities: {
      queries,
      mutations,
      inputs: typeOutputs.inputs,
      types: typeOutputs.types,
      fieldResolvers,
    },
  };
};

export default buildSchema;
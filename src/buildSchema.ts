import { DataSource, EntityMetadata } from 'typeorm';
import {
  type GraphQLFieldConfig,
  GraphQLObjectType as GQLObjectType,
  GraphQLSchema,
} from 'graphql';
import pluralize from 'pluralize';
import type { BuildSchemaConfig, GeneratedData } from './types.ts';
import { buildRelationMap, generateTypes } from './builders/common.ts';
import { generateResolvers } from './builders/resolvers.ts';
import { lowerFirst } from 'es-toolkit';

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
    throw new Error(
      'TypeQL Error: DataSource must be initialized before calling buildSchema()',
    );
  }

  const metadataList = config.entities
    ? dataSource.entityMetadatas.filter((metadata) =>
        config.entities!.includes(metadata.target as never),
      )
    : dataSource.entityMetadatas;

  if (metadataList.length === 0) {
    throw new Error(
      'TypeQL Error: No entity metadata found. Did you forget to add entities to the DataSource?',
    );
  }

  // Default typeNameMapper uses pluralize for automatic singular/plural
  const typeNameMapper =
    config.typeNameMapper ??
    ((name: string) => {
      name = lowerFirst(name);
      return {
        singular: name,
        plural: pluralize.plural(name),
      };
    });

  // Build entity and relation maps
  const entityMap: Record<string, EntityMetadata> = {};
  for (const meta of metadataList) {
    entityMap[meta.targetName] = meta;
  }
  const relationMap = buildRelationMap(metadataList);

  // Generate types
  const typeOutputs = generateTypes(
    metadataList,
    entityMap,
    relationMap,
    typeNameMapper,
    config.maxRelationDepth ?? 2,
  );

  // Generate resolvers
  const { queries, mutations, fieldResolvers } = generateResolvers(
    dataSource,
    metadataList,
    relationMap,
    typeNameMapper,
    typeOutputs,
  );

  // Build schema
  const schemaConfig: Record<string, unknown> = {
    query: new GQLObjectType({
      name: 'Query',
      fields: queries as Record<string, GraphQLFieldConfig<unknown, unknown>>,
    }),
    types: [...Object.values(typeOutputs.inputs)],
  };

  if (config.mutations !== false) {
    schemaConfig.mutation = new GQLObjectType({
      name: 'Mutation',
      fields: mutations as Record<string, GraphQLFieldConfig<unknown, unknown>>,
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

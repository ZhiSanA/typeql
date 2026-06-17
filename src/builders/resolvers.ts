import { DataSource, EntityMetadata } from 'typeorm';
import {
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';
import {
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
} from 'graphql';
import { getOrCreateLoader } from '../batch-loader/index.ts';
import {
  remapFromGraphQLArrayInput,
  remapFromGraphQLSingleInput,
  remapToGraphQLArrayOutput,
  remapToGraphQLSingleOutput,
} from '../data-mappers/index.ts';
import {
  type RelationMap,
  generateTypes,
  registerFieldResolver,
  deleteResultType,
} from './common.ts';
import { resolveNames, type TypeNameMapper } from './names.ts';

// ──────────────────────────────────────────────
// Filter conversion: GraphQL filter → TypeORM FindOptionsWhere
// ──────────────────────────────────────────────

function resolveWhere(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL filter input is dynamic
  argsWhere: any,
  meta: EntityMetadata,
  relationMap: RelationMap,
): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
  where: Record<string, any> | Record<string, any>[] | undefined;
  relations: string[];
} {
  if (!argsWhere) return { where: undefined, relations: [] };

  const columns = meta.ownColumns;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
  const result: Record<string, any> = {};
  const relations: string[] = [];

  // Extract OR conditions (TypeORM uses array syntax: where: [clause1, clause2])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
  let orClauses: Record<string, any>[] | undefined;
  if (argsWhere.or || argsWhere.OR) {
    const orKey = argsWhere.or ? 'or' : 'OR';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL filter input is dynamic
    const orParts = argsWhere[orKey] as any[];
    if (orParts?.length) {
      orClauses = orParts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL filter input is dynamic
        .map((whereClause: any) => resolveWhere(whereClause, meta, relationMap))
        .filter((r) => r.where != null && !Array.isArray(r.where))

        .map((r) => {
          relations.push(...r.relations);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
          return r.where as Record<string, any>;
        });
      if (orClauses.length === 0) orClauses = undefined;
    }
  }

  for (const [key, value] of Object.entries(argsWhere)) {
    if (key === 'or' || key === 'OR') continue;
    if (value == null) continue;

    // Check if this is a relation key
    const relationInfo = relationMap[meta.targetName]?.[key];
    if (relationInfo) {
      // Relation filter — recursively resolve
      const targetMeta = relationInfo.relation.inverseEntityMetadata;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL filter input is dynamic
      const sub = resolveWhere(value as any, targetMeta, relationMap);
      if (sub.where) {
        result[key] = sub.where;
        relations.push(key);
        // Add nested relation paths
        relations.push(...sub.relations.map((r: string) => `${key}.${r}`));
      }
      continue;
    }

    // Own column filter with operators
    if (typeof value === 'object' && value !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EntityMetadata column type
      const column = columns.find((column: any) => column.propertyName === key);
      if (!column) continue;

      for (const [operator, val] of Object.entries(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
        value as Record<string, any>,
      )) {
        if (val === undefined || val === null) continue;
        switch (operator) {
          case 'eq':
            result[key] = val;
            break;
          case 'ne':
            result[key] = Not(val);
            break;
          case 'lt':
            result[key] = LessThan(val);
            break;
          case 'lte':
            result[key] = LessThanOrEqual(val);
            break;
          case 'gt':
            result[key] = MoreThan(val);
            break;
          case 'gte':
            result[key] = MoreThanOrEqual(val);
            break;
          case 'like':
            result[key] = Like(val);
            break;
          case 'notLike':
            result[key] = Not(Like(val));
            break;
          case 'ilike':
            result[key] = Like(val);
            break;
          case 'notIlike':
            result[key] = Not(Like(val));
            break;
          case 'inArray':
          case 'in':
            result[key] = In(Array.isArray(val) ? val : [val]);
            break;
          case 'notInArray':
          case 'notIn':
            result[key] = Not(In(Array.isArray(val) ? val : [val]));
            break;
          case 'isNull':
            result[key] = IsNull();
            break;
          case 'isNotNull':
            result[key] = Not(IsNull());
            break;
        }
      }
    }
  }

  // If OR conditions exist, return as array (TypeORM array = OR semantics)
  const simpleWhere = Object.keys(result).length > 0 ? result : undefined;
  if (orClauses && orClauses.length > 0) {
    const finalWhere = simpleWhere ? [simpleWhere, ...orClauses] : orClauses;
    return { where: finalWhere, relations };
  }

  return { where: simpleWhere, relations };
}

/**
 * Convert a flat relation path array to TypeORM's nested object format.
 * ['author', 'author.profile'] → { author: { profile: true } }
 */
function buildRelationObject(
  paths: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM nested relation object
): Record<string, any> | undefined {
  if (!paths.length) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM nested relation object
  const result: Record<string, any> = {};
  for (const path of paths) {
    const parts = path.split('.');
    let current = result;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) {
        current[parts[i]!] = true;
      } else {
        const existing = current[parts[i]!];
        if (
          typeof existing !== 'object' ||
          existing === null ||
          existing === true
        ) {
          current[parts[i]!] = {};
        }
        current = current[parts[i]!];
      }
    }
  }
  return result;
}

function convertOrderBy(
  orderBy: Record<string, { direction: string; priority: number }> | undefined,
): Record<string, 'ASC' | 'DESC'> | undefined {
  if (!orderBy) return undefined;
  const entries = Object.entries(orderBy)
    .filter(([key, value]) => key != null && value != null)
    .sort((a, b) => (b[1]?.priority ?? 0) - (a[1]?.priority ?? 0));
  if (entries.length === 0) return undefined;
  const result: Record<string, 'ASC' | 'DESC'> = {};
  for (const [key, val] of entries)
    result[key] = val!.direction === 'desc' ? 'DESC' : 'ASC';
  return result;
}

// ──────────────────────────────────────────────
// Public entry point: generate all resolvers
// ──────────────────────────────────────────────

export function generateResolvers(
  dataSource: DataSource,
  metadataList: EntityMetadata[],
  relationMap: RelationMap,
  typeNameMapper: TypeNameMapper,
  typeOutputs: ReturnType<typeof generateTypes>,
): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config map
  queries: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config map
  mutations: Record<string, any>;
  fieldResolvers: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    Record<string, (...args: any[]) => Promise<any>>
  >;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config map
  const queries: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config map
  const mutations: Record<string, any> = {};
  const fieldResolvers: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    Record<string, (...args: any[]) => Promise<any>>
  > = {};

  for (const meta of metadataList) {
    const entityName = meta.targetName;
    const names = resolveNames(entityName, typeNameMapper);
    const typeName = names.typeName;
    const selectType = typeOutputs.types[typeName];
    if (!selectType) continue;

    const listType = new GraphQLNonNull(
      new GraphQLList(new GraphQLNonNull(selectType)),
    );
    const listResultType = typeOutputs.listResultTypes[entityName] as
      | GraphQLObjectType
      | undefined;
    const filterInput = typeOutputs.filters[entityName] as
      | GraphQLInputObjectType
      | undefined;
    const orderInput = typeOutputs.orders[entityName] as
      | GraphQLInputObjectType
      | undefined;
    const insertInput = typeOutputs.insertInputs[entityName] as
      | GraphQLInputObjectType
      | undefined;
    const updateInput = typeOutputs.updateInputs[entityName] as
      | GraphQLInputObjectType
      | undefined;
    const columns = meta.ownColumns;

    // ── List ──
    queries[names.listFieldName] = makeList(
      dataSource,
      meta,
      listResultType ?? listType,
      filterInput,
      orderInput,
      columns,
      relationMap,
    );

    // ── Single ──
    queries[names.singleFieldName] = makeSingle(
      dataSource,
      meta,
      selectType,
      filterInput,
      orderInput,
      columns,
      relationMap,
    );

    // ── Create ──
    if (insertInput) {
      mutations[names.createArrayFieldName] = makeCreateArray(
        dataSource,
        meta,
        insertInput,
        listType,
        columns,
      );
      mutations[names.createSingleFieldName] = makeCreateSingle(
        dataSource,
        meta,
        insertInput,
        selectType,
        columns,
      );
    }

    // ── Update ──
    if (updateInput) {
      mutations[names.updateFieldName] = makeUpdate(
        dataSource,
        meta,
        updateInput,
        filterInput,
        listType,
        columns,
        relationMap,
      );
    }

    // ── Delete ──
    mutations[names.deleteFieldName] = makeDelete(
      dataSource,
      meta,
      filterInput,
      listType,
      columns,
      relationMap,
    );
  }

  // Field resolvers for relations
  for (const [entityName, relations] of Object.entries(relationMap)) {
    const meta = metadataList.find((m) => m.targetName === entityName);
    if (!meta) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    const resolvers: Record<string, (...args: any[]) => Promise<any>> = {};
    for (const [relName, relationInfo] of Object.entries(relations)) {
      resolvers[relName] = createRelationResolver(
        dataSource,
        meta,
        relationInfo,
        relationMap,
      );
    }
    if (Object.keys(resolvers).length > 0) {
      fieldResolvers[entityName] = resolvers;
      for (const [relName, resolver] of Object.entries(resolvers)) {
        registerFieldResolver(entityName, relName, resolver);
      }
    }
  }

  return { queries, mutations, fieldResolvers };
}

// ── Helper: build args for filter/order ──
function filterArgs(
  filterInput?: GraphQLInputObjectType,
  orderInput?: GraphQLInputObjectType,
  extraOffset = true,
  extraLimit = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL arg config map
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL arg config map
  const resultArgs: Record<string, any> = {};
  if (filterInput) resultArgs['where'] = { type: filterInput };
  if (orderInput) resultArgs['orderBy'] = { type: orderInput };
  if (extraOffset) resultArgs['offset'] = { type: GraphQLInt };
  if (extraLimit) resultArgs['limit'] = { type: GraphQLInt };
  return resultArgs;
}

function makeList(
  dataSource: DataSource,
  meta: EntityMetadata,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL type is a GraphQL type, not any specific class
  resultType: any,
  filterInput?: GraphQLInputObjectType,
  orderInput?: GraphQLInputObjectType,
  columns?: EntityMetadata['ownColumns'],
  relationMap?: RelationMap,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config return type
): any {
  const target = meta.target;
  return {
    type: resultType,
    args: filterArgs(filterInput, orderInput, true, true),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    resolve: async (_source: any, args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity constructor
      const repository = dataSource.getRepository(target as any);
      const resolved = resolveWhere(args['where'], meta, relationMap!);
      const [records, count] = await repository.findAndCount({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
        where: resolved.where as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsRelations
        relations: buildRelationObject(resolved.relations) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM order
        order: convertOrderBy(args['orderBy']) as any,
        skip: args['offset'] ?? undefined,
        take: args['limit'] ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindManyOptions is generic
      } as any);
      return {
        rows: remapToGraphQLArrayOutput(records as any),
        pagination: {
          limit: args['limit'] ?? count,
          offset: args['offset'] ?? 0,
          count,
        },
      };
    },
  };
}

function makeSingle(
  dataSource: DataSource,
  meta: EntityMetadata,
  singleType: GraphQLObjectType,
  filterInput?: GraphQLInputObjectType,
  orderInput?: GraphQLInputObjectType,
  columns?: EntityMetadata['ownColumns'],
  relationMap?: RelationMap,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config return type
): any {
  const target = meta.target;
  return {
    type: singleType,
    args: filterArgs(filterInput, orderInput, true, false),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    resolve: async (_source: any, args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity constructor
      const repository = dataSource.getRepository(target as any);
      const resolved = resolveWhere(args['where'], meta, relationMap!);
      const result = await repository.findOne({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
        where: resolved.where as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsRelations
        relations: buildRelationObject(resolved.relations) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM order
        order: convertOrderBy(args['orderBy']) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOneOptions is generic
      } as any);
      if (!result) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity type is generic
      return remapToGraphQLSingleOutput(result as any);
    },
  };
}

function makeCreateArray(
  dataSource: DataSource,
  meta: EntityMetadata,
  insertInput: GraphQLInputObjectType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL type is a GraphQL type, not any specific class
  listType: any,
  columns: EntityMetadata['ownColumns'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config return type
): any {
  const target = meta.target;
  return {
    type: listType,
    args: {
      values: {
        type: new GraphQLNonNull(
          new GraphQLList(new GraphQLNonNull(insertInput)),
        ),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    resolve: async (_source: any, args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity constructor
      const repository = dataSource.getRepository(target as any);

      const mapped = remapFromGraphQLArrayInput(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL input array is dynamic
        args['values'] as any[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EntityMetadata column type
        columns as any,
      );
      const saved = await repository.save(repository.create(mapped));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity type is generic
      return remapToGraphQLArrayOutput(saved as any);
    },
  };
}

function makeCreateSingle(
  dataSource: DataSource,
  meta: EntityMetadata,
  insertInput: GraphQLInputObjectType,
  singleType: GraphQLObjectType,
  columns: EntityMetadata['ownColumns'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config return type
): any {
  const target = meta.target;
  return {
    type: singleType,
    args: { values: { type: new GraphQLNonNull(insertInput) } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    resolve: async (_source: any, args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity constructor
      const repository = dataSource.getRepository(target as any);

      const mapped = remapFromGraphQLSingleInput(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL input is dynamic
        args['values'] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EntityMetadata column type
        columns as any,
      );
      const saved = await repository.save(repository.create(mapped));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity type is generic
      return remapToGraphQLSingleOutput(saved as any);
    },
  };
}

function makeUpdate(
  dataSource: DataSource,
  meta: EntityMetadata,
  updateInput: GraphQLInputObjectType,
  filterInput: GraphQLInputObjectType | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL type is a GraphQL type, not any specific class
  listType: any,
  columns: EntityMetadata['ownColumns'],
  relationMap?: RelationMap,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config return type
): any {
  const target = meta.target;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL arg config map
  const args: Record<string, any> = {
    set: { type: new GraphQLNonNull(updateInput) },
  };
  if (filterInput) args['where'] = { type: filterInput };
  return {
    type: listType,
    args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    resolve: async (_source: any, args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity constructor
      const repository = dataSource.getRepository(target as any);
      const resolved = resolveWhere(args['where'], meta, relationMap!);
      const entities = await repository.find({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
        where: resolved.where as any,
        relations:
          resolved.relations.length > 0
            ? resolved.relations
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsRelations
              (undefined as any),
      });
      if (!entities.length) return [];

      const mapped = remapFromGraphQLSingleInput(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL input is dynamic
        args['set'] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EntityMetadata column type
        columns as any,
      );
      for (const entity of entities) Object.assign(entity, mapped);

      return remapToGraphQLArrayOutput(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity type is generic
        (await repository.save(entities)) as any,
      );
    },
  };
}

function makeDelete(
  dataSource: DataSource,
  meta: EntityMetadata,
  filterInput: GraphQLInputObjectType | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL type is a GraphQL type, not any specific class
  _listType: any,
  columns: EntityMetadata['ownColumns'],
  relationMap: RelationMap,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config return type
): any {
  const target = meta.target;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL arg config map
  const args: Record<string, any> = {};
  if (filterInput) args['where'] = { type: filterInput };
  return {
    type: deleteResultType,
    args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
    resolve: async (_source: any, args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity constructor
      const repository = dataSource.getRepository(target as any);
      const resolved = resolveWhere(args['where'], meta, relationMap);
      if (!resolved.where) return { affected: 0, raw: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
      const result = await repository.delete(resolved.where as any);
      return {
        affected: result.affected ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM delete result is generic
        raw: (result.raw ?? []).map((row: any) => String(row)),
      };
    },
  };
}

// ──────────────────────────────────────────────
// Relation resolver with N+1 batching
// ──────────────────────────────────────────────

function createRelationResolver(
  dataSource: DataSource,
  meta: EntityMetadata,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM relation metadata
  relationInfo: any,
  relationMap: RelationMap,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
): (...args: any[]) => Promise<any> {
  const propertyName = relationInfo.relation.propertyName;
  const isManyToMany = relationInfo.relation.relationType === 'many-to-many';
  const targetMeta = relationInfo.relation.inverseEntityMetadata;
  const targetPrimaryKey = targetMeta.primaryColumns[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity constructor
  const targetRepository = dataSource.getRepository(targetMeta.target as any);

  // Determine foreign key details from foreignKey metadata
  let foreignKeyPropertyName: string | undefined;

  if (!isManyToMany) {
    const foreignKeyOwner = relationInfo.isOwning ? meta : targetMeta;
    const foreignKeyTarget = relationInfo.isOwning ? targetMeta : meta;
    const primaryKey = foreignKeyTarget.primaryColumns[0];
    if (primaryKey) {
      for (const foreignKey of foreignKeyOwner.foreignKeys) {
        if (foreignKey.referencedColumns.includes(primaryKey)) {
          const foreignKeyColumn = foreignKey.columns[0];
          // Check if there's a standalone @Column with a different property name
          const matchingColumn = foreignKeyOwner.ownColumns.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EntityMetadata column type
            (column: any) =>
              column.databaseName === foreignKeyColumn?.databaseName &&
              column.propertyName !== propertyName,
          );
          foreignKeyPropertyName =
            matchingColumn?.propertyName ?? foreignKeyColumn?.propertyName;
          break;
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver function signature
  return async (source: any, args: any, context: any) => {
    // Check if relation-specific args are provided
    const hasArgs =
      args &&
      (args.where ||
        args.orderBy ||
        args.limit !== undefined ||
        args.offset !== undefined);

    // If data is pre-loaded on source and no args, use it directly
    if (source[propertyName] !== undefined && !hasArgs) {
      return source[propertyName];
    }

    const sourcePrimaryKeyColumn = meta.primaryColumns[0];
    if (!sourcePrimaryKeyColumn) return relationInfo.isOne ? null : [];

    // Parse relation args
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
    let resolvedWhere: any = undefined;
    if (args?.where) {
      const sub = resolveWhere(args.where, targetMeta, relationMap);
      resolvedWhere = sub.where;
    }
    const order = args?.orderBy ? convertOrderBy(args.orderBy) : undefined;
    const take = args?.limit ?? undefined;
    const skip = args?.offset ?? undefined;

    if (isManyToMany) {
      const primaryKeyValue = source[sourcePrimaryKeyColumn.propertyName];
      if (primaryKeyValue == null) return [];
      const junctionTable =
        relationInfo.relation.junctionEntityMetadata?.tableName;
      const joinColumn = relationInfo.relation.joinColumns?.[0]?.propertyName;
      const targetPrimaryKeyName = targetPrimaryKey?.propertyName;
      if (!junctionTable || !joinColumn || !targetPrimaryKeyName) return [];

      if (hasArgs) {
        let query = targetRepository
          .createQueryBuilder('t')
          .innerJoin(
            junctionTable,
            'junction',
            `"junction"."${targetPrimaryKeyName}" = "t"."${targetPrimaryKeyName}"`,
          )
          .where(`"junction"."${joinColumn}" = :primaryKeyValue`, {
            primaryKeyValue,
          });
        if (resolvedWhere) {
          for (const [whereKey, whereValue] of Object.entries(resolvedWhere)) {
            query = query.andWhere(`"t"."${whereKey}" = :${whereKey}`, {
              [whereKey]: whereValue,
            });
          }
        }
        if (order) {
          for (const [orderKey, orderDirection] of Object.entries(order)) {
            query = query.addOrderBy(`"t"."${orderKey}"`, orderDirection);
          }
        }
        if (take) query = query.take(take);
        if (skip) query = query.skip(skip);
        return query.getMany();
      }

      return targetRepository
        .createQueryBuilder('t')
        .innerJoin(
          junctionTable,
          'junction',
          `"junction"."${targetPrimaryKeyName}" = "t"."${targetPrimaryKeyName}"`,
        )
        .where(`"junction"."${joinColumn}" IN (:...ids)`, {
          ids: [primaryKeyValue],
        })
        .getMany();
    }

    if (relationInfo.isOwning) {
      // ManyToOne — single entity, ignore args, keep batch loader
      const foreignKeyValue = foreignKeyPropertyName
        ? source[foreignKeyPropertyName]
        : undefined;
      if (foreignKeyValue == null) return null;
      const targetPrimaryKeyName = targetPrimaryKey?.propertyName;
      if (!targetPrimaryKeyName) return null;

      const loader = getOrCreateLoader(
        context,
        `${meta.targetName}::${propertyName}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Batch loader keys are generic
        async (keys: readonly any[]) => {
          const unique = [...new Set(keys)];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM repository generics
          const results = await (targetRepository as any).find({
            where: { [targetPrimaryKeyName]: In(unique) },
          });
          const byId = new Map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity type is generic
            results.map((row: any) => [String(row[targetPrimaryKeyName]), row]),
          );
          return keys.map((key) => byId.get(String(key)) ?? null);
        },
      );
      return loader.load(foreignKeyValue);
    } else {
      // OneToMany — check hasArgs
      const primaryKeyValue = source[sourcePrimaryKeyColumn.propertyName];
      if (primaryKeyValue == null || !foreignKeyPropertyName) return [];

      if (hasArgs) {
        // Direct query with args

        const whereClause = resolvedWhere
          ? { ...resolvedWhere, [foreignKeyPropertyName]: primaryKeyValue }
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM FindOptionsWhere values
            ({ [foreignKeyPropertyName]: primaryKeyValue } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM repository generics
        return (targetRepository as any).find({
          where: whereClause,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM order
          order: order as any,
          take,
          skip,
        });
      }

      // Batch loaded (no args)
      const loader = getOrCreateLoader(
        context,
        `${meta.targetName}::${propertyName}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Batch loader keys are generic
        async (keys: readonly any[]) => {
          const unique = [...new Set(keys)];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM repository generics
          const results = await (targetRepository as any).find({
            where: { [foreignKeyPropertyName]: In(unique) },
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity type is generic
          const grouped = new Map<string, any[]>();
          for (const id of unique) grouped.set(String(id), []);

          for (const row of results) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM entity type is generic
            const pid = (row as any)[foreignKeyPropertyName];
            if (pid !== undefined) grouped.get(String(pid))?.push(row);
          }
          return keys.map((key) => grouped.get(String(key)) ?? []);
        },
      );
      return loader.load(primaryKeyValue);
    }
  };
}

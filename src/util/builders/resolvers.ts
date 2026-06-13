import { DataSource, EntityMetadata } from 'typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, Like, MoreThan, MoreThanOrEqual, Not } from 'typeorm';
import {
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
} from 'graphql';
import { getOrCreateLoader } from '../batch-loader/index.ts';
import { remapFromGraphQLArrayInput, remapFromGraphQLSingleInput, remapToGraphQLArrayOutput, remapToGraphQLSingleOutput } from '../data-mappers/index.ts';
import type { BuildSchemaConfig } from '../../types.ts';
import { type RelationMap, generateTypes, registerFieldResolver } from './common.ts';
import { resolveNames } from './names.ts';

// ──────────────────────────────────────────────
// Filter conversion: GraphQL filter → TypeORM FindOptionsWhere
// ──────────────────────────────────────────────

function convertFilters(
  where: Record<string, any> | undefined,
  columns: EntityMetadata['ownColumns'],
): Record<string, any> | undefined {
  if (!where) return undefined;
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(where)) {
    if (key === 'or' || key === 'OR') continue;
    if (value == null || typeof value !== 'object') continue;

    const col = columns.find((c: any) => c.propertyName === key);
    if (!col) continue;

    for (const [op, val] of Object.entries(value)) {
      if (val === undefined || val === null) continue;
      switch (op) {
        case 'eq': result[key] = val; break;
        case 'ne': result[key] = Not(val); break;
        case 'lt': result[key] = LessThan(val); break;
        case 'lte': result[key] = LessThanOrEqual(val); break;
        case 'gt': result[key] = MoreThan(val); break;
        case 'gte': result[key] = MoreThanOrEqual(val); break;
        case 'like': result[key] = Like(val); break;
        case 'notLike': result[key] = Not(Like(val)); break;
        case 'ilike': result[key] = Like(val); break;
        case 'notIlike': result[key] = Not(Like(val)); break;
        case 'inArray': case 'in':
          result[key] = In(Array.isArray(val) ? val : [val]); break;
        case 'notInArray': case 'notIn':
          result[key] = Not(In(Array.isArray(val) ? val : [val])); break;
        case 'isNull':
          result[key] = IsNull(); break;
        case 'isNotNull':
          result[key] = Not(IsNull()); break;
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function convertOrderBy(
  orderBy: Record<string, { direction: string; priority: number }> | undefined,
): Record<string, 'ASC' | 'DESC'> | undefined {
  if (!orderBy) return undefined;
  const entries = Object.entries(orderBy)
    .filter(([_, v]) => v != null)
    .sort((a, b) => (b[1]?.priority ?? 0) - (a[1]?.priority ?? 0));
  if (entries.length === 0) return undefined;
  const result: Record<string, 'ASC' | 'DESC'> = {};
  for (const [key, val] of entries) result[key] = val!.direction === 'desc' ? 'DESC' : 'ASC';
  return result;
}

function resolveWhere(argsWhere: any, columns: EntityMetadata['ownColumns']): any {
  const simple = convertFilters(argsWhere, columns);
  const orParts = argsWhere?.or as any[];
  if (orParts?.length) {
    const orClauses = orParts.map((w: any) => convertFilters(w, columns)).filter(Boolean);
    if (simple) return [simple, ...orClauses];
    return orClauses.length > 0 ? orClauses : undefined;
  }
  return simple;
}

// ──────────────────────────────────────────────
// Public entry point: generate all resolvers
// ──────────────────────────────────────────────

export function generateResolvers(
  dataSource: DataSource,
  entityMetadatas: EntityMetadata[],
  relationMap: RelationMap,
  config: BuildSchemaConfig,
  typeOutputs: ReturnType<typeof generateTypes>,
): {
  queries: Record<string, any>;
  mutations: Record<string, any>;
  fieldResolvers: Record<string, Record<string, (...args: any[]) => Promise<any>>>;
} {
  const prefixes = { insert: 'create', update: 'update', delete: 'delete', ...config.prefixes };
  const suffixes = { list: '', single: 'Single', ...config.suffixes };
  const queries: Record<string, any> = {};
  const mutations: Record<string, any> = {};
  const fieldResolvers: Record<string, Record<string, (...args: any[]) => Promise<any>>> = {};

  for (const meta of entityMetadatas) {
    const entityName = meta.targetName;
    const names = resolveNames(entityName, prefixes, suffixes, config.typeNameMapper);
    const typeName = names.typeName;
    const selectType = typeOutputs.types[typeName];
    if (!selectType) continue;

    const listType = new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(selectType)));
    const filterInput = typeOutputs.filters[entityName] as GraphQLInputObjectType | undefined;
    const orderInput = typeOutputs.orders[entityName] as GraphQLInputObjectType | undefined;
    const insertInput = typeOutputs.insertInputs[entityName] as GraphQLInputObjectType | undefined;
    const updateInput = typeOutputs.updateInputs[entityName] as GraphQLInputObjectType | undefined;
    const columns = meta.ownColumns;

    // ── List ──
    queries[names.listFieldName] = makeList(dataSource, meta, listType, filterInput, orderInput, columns);

    // ── Single ──
    queries[names.singleFieldName] = makeSingle(dataSource, meta, selectType, filterInput, orderInput, columns);

    // ── Create ──
    if (insertInput) {
      mutations[names.createArrayFieldName] = makeCreateArray(dataSource, meta, insertInput, listType, columns);
      mutations[names.createSingleFieldName] = makeCreateSingle(dataSource, meta, insertInput, selectType, columns);
    }

    // ── Update ──
    if (updateInput) {
      mutations[names.updateFieldName] = makeUpdate(dataSource, meta, updateInput, filterInput, listType, columns);
    }

    // ── Delete ──
    mutations[names.deleteFieldName] = makeDelete(dataSource, meta, filterInput, listType, columns);
  }

  // Field resolvers for relations
  for (const [entityName, rels] of Object.entries(relationMap)) {
    const meta = entityMetadatas.find((m) => m.targetName === entityName);
    if (!meta) continue;
    const resolvers: Record<string, (...args: any[]) => Promise<any>> = {};
    for (const [relName, relInfo] of Object.entries(rels)) {
      resolvers[relName] = createRelationResolver(dataSource, meta, relInfo);
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
function filterArgs(filterInput?: GraphQLInputObjectType, orderInput?: GraphQLInputObjectType, extraOffset = true, extraLimit = false): Record<string, any> {
  const a: Record<string, any> = {};
  if (filterInput) a['where'] = { type: filterInput };
  if (orderInput) a['orderBy'] = { type: orderInput };
  if (extraOffset) a['offset'] = { type: GraphQLInt };
  if (extraLimit) a['limit'] = { type: GraphQLInt };
  return a;
}

function makeList(ds: DataSource, meta: EntityMetadata, listType: any, fi?: GraphQLInputObjectType, oi?: GraphQLInputObjectType, cols?: EntityMetadata['ownColumns']): any {
  const target = meta.target;
  return {
    type: listType,
    args: filterArgs(fi, oi, true, true),
    resolve: async (_s: any, args: any) => {
      const repo = ds.getRepository(target as any);
      return remapToGraphQLArrayOutput(await repo.find({
        where: resolveWhere(args['where'], cols!) as any,
        order: convertOrderBy(args['orderBy']) as any,
        skip: args['offset'] ?? undefined,
        take: args['limit'] ?? undefined,
      }) as any);
    },
  };
}

function makeSingle(ds: DataSource, meta: EntityMetadata, st: GraphQLObjectType, fi?: GraphQLInputObjectType, oi?: GraphQLInputObjectType, cols?: EntityMetadata['ownColumns']): any {
  const target = meta.target;
  return {
    type: st,
    args: filterArgs(fi, oi, true, false),
    resolve: async (_s: any, args: any) => {
      const repo = ds.getRepository(target as any);
      const result = await repo.findOne({
        where: resolveWhere(args['where'], cols!) as any,
        order: convertOrderBy(args['orderBy']) as any,
      } as any);
      if (!result) return null;
      return remapToGraphQLSingleOutput(result as any);
    },
  };
}

function makeCreateArray(ds: DataSource, meta: EntityMetadata, ii: GraphQLInputObjectType, lt: any, cols: EntityMetadata['ownColumns']): any {
  const target = meta.target;
  return {
    type: lt,
    args: { values: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ii))) } },
    resolve: async (_s: any, args: any) => {
      const repo = ds.getRepository(target as any);
      const mapped = remapFromGraphQLArrayInput(args['values'] as any[], cols as any);
      const saved = await repo.save(repo.create(mapped));
      return remapToGraphQLArrayOutput(saved as any);
    },
  };
}

function makeCreateSingle(ds: DataSource, meta: EntityMetadata, ii: GraphQLInputObjectType, st: GraphQLObjectType, cols: EntityMetadata['ownColumns']): any {
  const target = meta.target;
  return {
    type: st,
    args: { values: { type: new GraphQLNonNull(ii) } },
    resolve: async (_s: any, args: any) => {
      const repo = ds.getRepository(target as any);
      const mapped = remapFromGraphQLSingleInput(args['values'] as any, cols as any);
      const saved = await repo.save(repo.create(mapped));
      return remapToGraphQLSingleOutput(saved as any);
    },
  };
}

function makeUpdate(ds: DataSource, meta: EntityMetadata, ui: GraphQLInputObjectType, fi: GraphQLInputObjectType | undefined, lt: any, cols: EntityMetadata['ownColumns']): any {
  const target = meta.target;
  const args: Record<string, any> = { set: { type: new GraphQLNonNull(ui) } };
  if (fi) args['where'] = { type: fi };
  return {
    type: lt,
    args,
    resolve: async (_s: any, args: any) => {
      const repo = ds.getRepository(target as any);
      const entities = await repo.find({ where: resolveWhere(args['where'], cols!) as any });
      if (!entities.length) return [];
      const mapped = remapFromGraphQLSingleInput(args['set'] as any, cols as any);
      for (const e of entities) Object.assign(e, mapped);
      return remapToGraphQLArrayOutput(await repo.save(entities) as any);
    },
  };
}

function makeDelete(ds: DataSource, meta: EntityMetadata, fi: GraphQLInputObjectType | undefined, lt: any, cols: EntityMetadata['ownColumns']): any {
  const target = meta.target;
  const args: Record<string, any> = {};
  if (fi) args['where'] = { type: fi };
  return {
    type: lt,
    args,
    resolve: async (_s: any, args: any) => {
      const repo = ds.getRepository(target as any);
      const entities = await repo.find({ where: resolveWhere(args['where'], cols!) as any });
      if (!entities.length) return [];
      return remapToGraphQLArrayOutput(await repo.remove(entities) as any);
    },
  };
}

// ──────────────────────────────────────────────
// Relation resolver with N+1 batching
// ──────────────────────────────────────────────

function createRelationResolver(ds: DataSource, meta: EntityMetadata, relInfo: any): (...args: any[]) => Promise<any> {
  const propertyName = relInfo.relation.propertyName;
  const isList = !relInfo.isOne;
  const isManyToMany = relInfo.relation.relationType === 'many-to-many';
  const targetMeta = relInfo.relation.inverseEntityMetadata;
  const targetPk = targetMeta.primaryColumns[0];
  const targetRepo = ds.getRepository(targetMeta.target as any);
  const sourceRepo = ds.getRepository(meta.target as any);

  // Determine FK details from foreignKey metadata
  // For owning side (ManyToOne): fkOwner = meta, pk = targetPk
  // For inverse side (OneToMany): fkOwner = targetMeta, pk = meta PK
  // fkPropertyName = the propertyName on the FK owner entity that holds the FK scalar value
  //   For @JoinColumn({ name: 'authorId' }) => propertyName = 'author' (the relation)
  //   For @Column() authorId on owning side => propertyName = 'authorId'
  let fkPropertyName: string | undefined;

  if (!isManyToMany) {
    const fkOwner = relInfo.isOwning ? meta : targetMeta;
    const fkTarget = relInfo.isOwning ? targetMeta : meta;
    const pk = fkTarget.primaryColumns[0];
    if (pk) {
      for (const fk of fkOwner.foreignKeys) {
        if (fk.referencedColumns.includes(pk)) {
          const fkCol = fk.columns[0];
          // Try to find a column whose propertyName matches fkCol.propertyName
          // If the join column's propertyName equals the relation name, we need to
          // check if there's also a standalone @Column with a different property name
          // but matching databaseName (e.g. user defined @Column() authorId)
          const matchingCol = fkOwner.ownColumns.find(
            (c: any) => c.databaseName === fkCol?.databaseName && c.propertyName !== propertyName,
          );
          // Prefer the standalone column if found, otherwise use the join column's property
          fkPropertyName = matchingCol?.propertyName ?? fkCol?.propertyName;
          break;
        }
      }
    }
  }

  return async (source: any, _args: any, context: any) => {
    if (source[propertyName] !== undefined) {
      return source[propertyName];
    }

    const srcPkCol = meta.primaryColumns[0];
    if (!srcPkCol) return isList ? [] : null;

    if (isManyToMany) {
      const pkValue = source[srcPkCol.propertyName];
      if (pkValue == null) return [];
      const jt = relInfo.relation.junctionEntityMetadata?.tableName;
      const jc = relInfo.relation.joinColumns?.[0]?.propertyName;
      const tpk = targetPk?.propertyName;
      if (!jt || !jc || !tpk) return [];
      return targetRepo.createQueryBuilder('t')
        .innerJoin(jt, 'j', `"j"."${tpk}" = "t"."${tpk}"`)
        .where(`"j"."${jc}" IN (:...ids)`, { ids: [pkValue] })
        .getMany();
    }

    if (relInfo.isOwning) {
      // ManyToOne: FK value is accessible as a property on the source entity
      const fkValue = fkPropertyName ? source[fkPropertyName] : undefined;
      if (fkValue == null) return null;
      const targetPkName = targetPk?.propertyName;
      if (!targetPkName) return null;

      const loader = getOrCreateLoader(`${meta.targetName}::${propertyName}`, `${meta.targetName}::${propertyName}`, async (keys: readonly any[]) => {
        const unique = [...new Set(keys)];
        const results = await (targetRepo as any).find({ where: { [targetPkName]: In(unique) } });
        const byId = new Map(results.map((r: any) => [String(r[targetPkName]), r]));
        return keys.map(k => byId.get(String(k)) ?? null);
      });
      return loader.load(fkValue);
    } else {
      // OneToMany: FK is on target entity — batch by source PK
      const pkValue = source[srcPkCol.propertyName];
      if (pkValue == null || !fkPropertyName) return [];

      const loader = getOrCreateLoader(`${meta.targetName}::${propertyName}`, `${meta.targetName}::${propertyName}`, async (keys: readonly any[]) => {
        const unique = [...new Set(keys)];
        const results = await (targetRepo as any).find({ where: { [fkPropertyName!]: In(unique) } });
        const grouped = new Map<string, any[]>();
        for (const id of unique) grouped.set(String(id), []);
        for (const row of results) {
          const pid = (row as any)[fkPropertyName!];
          if (pid !== undefined) grouped.get(String(pid))?.push(row);
        }
        return keys.map(k => grouped.get(String(k)) ?? []);
      });
      return loader.load(pkValue);
    }
  };
}
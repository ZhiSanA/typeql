import type {
  EntityMetadata,
} from 'typeorm';
import type { DataSource } from 'typeorm';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { GraphQLDate, GraphQLDateTime } from 'graphql-scalars';
import { capitalize, uncapitalize } from '../case-ops/index.ts';
import { typeormColumnToGraphQLType } from '../type-converter/index.ts';
import type { ConvertedColumn } from '../type-converter/types.ts';
import { resolveNames, type TypeNameMapper } from './names.ts';

// ──────────────────────────────────────────────
// Metadata extraction
// ──────────────────────────────────────────────

export interface RelationInfo {
  relationType: 'one-to-one' | 'many-to-one' | 'one-to-many' | 'many-to-many';
  isOwning: boolean;
  targetEntityName: string;
  relation: any;
  isOne: boolean;
}

export type RelationMap = Record<string, Record<string, RelationInfo>>;

export function extractEntityMap(dataSource: DataSource): EntityMetadata[] {
  return dataSource.entityMetadatas;
}

export function buildRelationMap(metadatas: EntityMetadata[]): RelationMap {
  const map: RelationMap = {};
  for (const meta of metadatas) {
    const name = meta.targetName;
    const rels: Record<string, RelationInfo> = {};
    for (const rel of meta.relations) {
      if (rel.isTreeParent || rel.isTreeChildren) continue;
      if (rel.isLazy) continue;

      const isOne = rel.relationType === 'one-to-one' || rel.relationType === 'many-to-one';
      rels[rel.propertyName] = {
        relationType: rel.relationType,
        isOwning: rel.isOwning,
        targetEntityName: rel.inverseEntityMetadata.targetName,
        relation: rel,
        isOne,
      };
    }
    if (Object.keys(rels).length > 0) {
      map[name] = rels;
    }
  }
  return map;
}

// ──────────────────────────────────────────────
// Generic shared filter types
// ──────────────────────────────────────────────

const sharedFilters = new Map<string, GraphQLInputObjectType>();

function getOrCreateSharedFilter(
  name: string,
  fieldsFn: () => Record<string, any>,
): GraphQLInputObjectType {
  if (sharedFilters.has(name)) return sharedFilters.get(name)!;
  const main = new GraphQLInputObjectType({ name: `${name}Filter`, fields: fieldsFn });
  sharedFilters.set(name, main);
  return main;
}

function stringFilterFields(): Record<string, any> {
  return {
    eq: { type: GraphQLString },
    ne: { type: GraphQLString },
    like: { type: GraphQLString },
    notLike: { type: GraphQLString },
    ilike: { type: GraphQLString },
    notIlike: { type: GraphQLString },
    in: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
    notIn: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
    isNull: { type: GraphQLBoolean },
    isNotNull: { type: GraphQLBoolean },
  };
}

function intFilterFields(): Record<string, any> {
  return {
    eq: { type: GraphQLInt },
    ne: { type: GraphQLInt },
    lt: { type: GraphQLInt },
    lte: { type: GraphQLInt },
    gt: { type: GraphQLInt },
    gte: { type: GraphQLInt },
    in: { type: new GraphQLList(new GraphQLNonNull(GraphQLInt)) },
    notIn: { type: new GraphQLList(new GraphQLNonNull(GraphQLInt)) },
    isNull: { type: GraphQLBoolean },
    isNotNull: { type: GraphQLBoolean },
  };
}

function floatFilterFields(): Record<string, any> {
  return {
    eq: { type: GraphQLFloat },
    ne: { type: GraphQLFloat },
    lt: { type: GraphQLFloat },
    lte: { type: GraphQLFloat },
    gt: { type: GraphQLFloat },
    gte: { type: GraphQLFloat },
    in: { type: new GraphQLList(new GraphQLNonNull(GraphQLFloat)) },
    notIn: { type: new GraphQLList(new GraphQLNonNull(GraphQLFloat)) },
    isNull: { type: GraphQLBoolean },
    isNotNull: { type: GraphQLBoolean },
  };
}

function booleanFilterFields(): Record<string, any> {
  return {
    eq: { type: GraphQLBoolean },
    ne: { type: GraphQLBoolean },
    isNull: { type: GraphQLBoolean },
    isNotNull: { type: GraphQLBoolean },
  };
}

function dateTimeFilterFields(): Record<string, any> {
  return {
    eq: { type: GraphQLDateTime },
    ne: { type: GraphQLDateTime },
    lt: { type: GraphQLDateTime },
    lte: { type: GraphQLDateTime },
    gt: { type: GraphQLDateTime },
    gte: { type: GraphQLDateTime },
    in: { type: new GraphQLList(new GraphQLNonNull(GraphQLDateTime)) },
    notIn: { type: new GraphQLList(new GraphQLNonNull(GraphQLDateTime)) },
    isNull: { type: GraphQLBoolean },
    isNotNull: { type: GraphQLBoolean },
  };
}

function dateFilterFields(): Record<string, any> {
  return {
    eq: { type: GraphQLDate },
    ne: { type: GraphQLDate },
    lt: { type: GraphQLDate },
    lte: { type: GraphQLDate },
    gt: { type: GraphQLDate },
    gte: { type: GraphQLDate },
    in: { type: new GraphQLList(new GraphQLNonNull(GraphQLDate)) },
    notIn: { type: new GraphQLList(new GraphQLNonNull(GraphQLDate)) },
    isNull: { type: GraphQLBoolean },
    isNotNull: { type: GraphQLBoolean },
  };
}

type ColumnFilterCategory = 'string' | 'int' | 'float' | 'boolean' | 'date' | 'datetime' | 'enum';

function classifyColumn(meta: EntityMetadata): (colName: string) => ColumnFilterCategory {
  return (colName: string) => {
    const colMeta = meta.ownColumns.find((c: any) => c.propertyName === colName);
    if (!colMeta) return 'string';
    const t = String(colMeta.type).toLowerCase();
    if (colMeta.enum && colMeta.enum.length > 0) return 'enum';
    if (['int', 'integer', 'smallint', 'mediumint', 'tinyint'].includes(t)) return 'int';
    if (['float', 'double', 'decimal', 'numeric', 'real', 'money'].includes(t)) return 'float';
    if (['boolean', 'bool'].includes(t) || (t === 'tinyint' && colMeta.length === '1')) return 'boolean';
    if (t.includes('timestamp') || t === 'datetime' || t === 'timestamptz') return 'datetime';
    if (t === 'date') return 'date';
    return 'string';
  };
}

// ──────────────────────────────────────────────
// Field resolvers for relations (mutable, populated by resolvers.ts)
// ──────────────────────────────────────────────

export const relationResolvers = new Map<string, (source: any, args: any, context: any) => Promise<any>>();

export function registerFieldResolver(
  entityName: string,
  relName: string,
  resolver: (source: any, args: any, context: any) => Promise<any>,
): void {
  relationResolvers.set(`${entityName}.${relName}`, resolver);
}

// ── Relation filter/order cache for field arguments ──
export const relationFilterCache = new Map<string, GraphQLInputObjectType>();
export const relationOrderCache = new Map<string, GraphQLInputObjectType>();

// ── DeleteResult type ──
export const deleteResultType = new GraphQLObjectType({
  name: 'DeleteResult',
  fields: {
    affected: { type: new GraphQLNonNull(GraphQLInt) },
    raw: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
  },
});

// ──────────────────────────────────────────────
// Type cache — one GraphQLObjectType per typeName
// Fields are deferred via thunks, so circular refs work.
// ──────────────────────────────────────────────

const typeCache = new Map<string, GraphQLObjectType>();
const typeMetaMap = new Map<string, { meta: EntityMetadata; relations: Record<string, RelationInfo> }>();

function buildOrGetType(
  typeName: string,
  meta: EntityMetadata,
  entityMap: Record<string, EntityMetadata>,
  relationMap: RelationMap,
  typeNameMapper: TypeNameMapper,
): GraphQLObjectType {
  if (typeCache.has(typeName)) {
    return typeCache.get(typeName)!;
  }

  // Store metadata for thunk resolution
  typeMetaMap.set(typeName, { meta, relations: relationMap[meta.targetName] ?? {} });

  const gqlType = new GraphQLObjectType({
    name: typeName,
    fields: () => {
      const fields: Record<string, any> = {};
      for (const col of meta.ownColumns) {
        const converted = typeormColumnToGraphQLType(col, meta.targetName, false);
        fields[col.propertyName] = { type: converted.type };
      }
      const stored = typeMetaMap.get(typeName);
      const relations = stored?.relations ?? {};
      for (const [relName, relInfo] of Object.entries(relations)) {
        const info = relInfo as RelationInfo;
        const targetMeta = entityMap[info.targetEntityName];
        if (!targetMeta) continue;
        const targetNames = resolveNames(info.targetEntityName, typeNameMapper);
        const targetType = buildOrGetType(targetNames.typeName, targetMeta, entityMap, relationMap, typeNameMapper);
        const resolverKey = `${meta.targetName}.${relName}`;
        const fieldResolver = relationResolvers.get(resolverKey);
        if (info.isOne) {
          fields[relName] = { type: targetType, resolve: fieldResolver };
        } else {
          // list relation: add where/orderBy/limit/offset args
          const targetFilter = relationFilterCache.get(info.targetEntityName);
          const targetOrder = relationOrderCache.get(info.targetEntityName);
          const relArgs: Record<string, any> = {};
          if (targetFilter) relArgs['where'] = { type: targetFilter };
          if (targetOrder) relArgs['orderBy'] = { type: targetOrder };
          relArgs['limit'] = { type: GraphQLInt };
          relArgs['offset'] = { type: GraphQLInt };
          fields[relName] = {
            type: new GraphQLList(new GraphQLNonNull(targetType)),
            args: relArgs,
            resolve: fieldResolver,
          };
        }
      }
      return fields;
    },
  });

  typeCache.set(typeName, gqlType);
  return gqlType;
}

export interface EntityTypeBundle {
  outputType: GraphQLObjectType;
  insertInput: GraphQLInputObjectType;
  updateInput: GraphQLInputObjectType;
  filterInput: GraphQLInputObjectType;
  orderInput: GraphQLInputObjectType;
}

export function buildTableTypes(
  meta: EntityMetadata,
  entityMap: Record<string, EntityMetadata>,
  relationMap: RelationMap,
  typeNameMapper: TypeNameMapper,
  names: { typeName: string },
  relationDepth = 2,
): EntityTypeBundle & { relationFields: Record<string, ConvertedColumn> } {
  const entityName = meta.targetName;
  const typeName = names.typeName;
  const columns: any[] = meta.ownColumns;
  const classifyFn = classifyColumn(meta);

  // Output type (via cache to handle circular refs)
  const outputType = buildOrGetType(typeName, meta, entityMap, relationMap, typeNameMapper);

  // ── Insert input ──
  const insertFields: Record<string, any> = {};
  for (const col of columns) {
    if (col.isGenerated && col.generationStrategy === 'increment') continue;
    const converted = typeormColumnToGraphQLType(col, entityName, true);
    insertFields[col.propertyName] = { type: converted.type };
  }
  const insertInput = new GraphQLInputObjectType({
    name: `Create${typeName}Input`,
    fields: insertFields,
  });

  // ── Update input ──
  const updateFields: Record<string, any> = {};
  for (const col of columns) {
    if (col.isGenerated && col.generationStrategy === 'increment') continue;
    const converted = typeormColumnToGraphQLType(col, entityName, true);
    updateFields[col.propertyName] = { type: converted.type };
  }
  const updateInput = new GraphQLInputObjectType({
    name: `Update${typeName}Input`,
    fields: updateFields,
  });

  // ── Filter input ──
  const filterFields: Record<string, any> = {};
  for (const col of columns) {
    const cat = classifyFn(col.propertyName);
    let filterType: GraphQLInputObjectType;
    switch (cat) {
      case 'float': filterType = getOrCreateSharedFilter('Float', floatFilterFields); break;
      case 'boolean': filterType = getOrCreateSharedFilter('Boolean', booleanFilterFields); break;
      case 'date': filterType = getOrCreateSharedFilter('Date', dateFilterFields); break;
      case 'datetime': filterType = getOrCreateSharedFilter('DateTime', dateTimeFilterFields); break;
      case 'enum': filterType = makeEnumFilter(col, entityName); break;
      case 'int': filterType = getOrCreateSharedFilter('Int', intFilterFields); break;
      default: filterType = getOrCreateSharedFilter('String', stringFilterFields);
    }
    filterFields[col.propertyName] = { type: filterType };
  }

  // ── Relation filter fields ──
  const rels = relationMap[entityName] ?? {};
  if (relationDepth > 0) {
    const visitedEntities = new Set<string>([entityName]);
    for (const [relName, relInfo] of Object.entries(rels)) {
      const targetEntityName = relInfo.targetEntityName;
      if (visitedEntities.has(targetEntityName)) continue;
      visitedEntities.add(targetEntityName);
      const targetMeta = entityMap[targetEntityName];
      if (!targetMeta) { visitedEntities.delete(targetEntityName); continue; }
      const subFilter = generateRelationFilter(
        `${typeName}_${relName}`,
        targetMeta,
        entityMap,
        relationMap,
        visitedEntities,
        relationDepth,
        0,
      );
      visitedEntities.delete(targetEntityName);
      if (subFilter) {
        filterFields[relName] = { type: subFilter };
      }
    }
  }

  const filterInput = new GraphQLInputObjectType({
    name: `${typeName}Filter`,
    fields: () => {
      const orType = new GraphQLInputObjectType({
        name: `${typeName}_OrFilter`,
        fields: () => ({ ...filterFields }),
      });
      return { ...filterFields, or: { type: new GraphQLList(new GraphQLNonNull(orType)) } };
    },
  });
  relationFilterCache.set(entityName, filterInput);

  // ── Order input ──
  const orderFields: Record<string, any> = {};
  for (const col of columns) {
    const dirEnum = new GraphQLEnumType({
      name: `${typeName}_${capitalize(col.propertyName)}_Dir`,
      values: { ASC: { value: 'ASC' }, DESC: { value: 'DESC' } },
    });
    orderFields[col.propertyName] = {
      type: new GraphQLInputObjectType({
        name: `${typeName}_${capitalize(col.propertyName)}_Order`,
        fields: {
          direction: { type: new GraphQLNonNull(dirEnum) },
          priority: { type: new GraphQLNonNull(GraphQLInt) },
        },
      }),
    };
  }
  const orderInput = new GraphQLInputObjectType({
    name: `${typeName}OrderBy`,
    fields: orderFields,
  });
  relationOrderCache.set(entityName, orderInput);

  return { outputType, insertInput, updateInput, filterInput, orderInput, relationFields: {} };
}

function makeEnumFilter(col: any, entityName: string): GraphQLInputObjectType {
  const gqlType = typeormColumnToGraphQLType(col, entityName, false);
  const enumGqlType = gqlType.type instanceof GraphQLEnumType ? gqlType.type : GraphQLString;
  const filterName = `${entityName}_${capitalize(col.propertyName)}_EnumFilter`;
  return new GraphQLInputObjectType({
    name: filterName,
    fields: {
      eq: { type: enumGqlType },
      ne: { type: enumGqlType },
      in: { type: new GraphQLList(new GraphQLNonNull(enumGqlType)) },
      notIn: { type: new GraphQLList(new GraphQLNonNull(enumGqlType)) },
      isNull: { type: GraphQLBoolean },
      isNotNull: { type: GraphQLBoolean },
    },
  });
}

// ── Recursive relation filter generator ──
function generateRelationFilter(
  entityName: string,
  meta: EntityMetadata,
  entityMap: Record<string, EntityMetadata>,
  relationMap: RelationMap,
  visitedEntities: Set<string>,
  depthLimit: number,
  currentDepth: number,
): GraphQLInputObjectType | null {
  // Guard: depth limit
  if (currentDepth > depthLimit) return null;

  const filterName = `${entityName}_RelationFilter`;
  const classifyFn = classifyColumn(meta);
  const columns = meta.ownColumns;

  // Build scalar filter fields
  const filterFields: Record<string, any> = {};
  for (const col of columns) {
    const cat = classifyFn(col.propertyName);
    let filterType: GraphQLInputObjectType;
    switch (cat) {
      case 'float': filterType = getOrCreateSharedFilter('Float', floatFilterFields); break;
      case 'boolean': filterType = getOrCreateSharedFilter('Boolean', booleanFilterFields); break;
      case 'date': filterType = getOrCreateSharedFilter('Date', dateFilterFields); break;
      case 'datetime': filterType = getOrCreateSharedFilter('DateTime', dateTimeFilterFields); break;
      case 'enum': filterType = makeEnumFilter(col, meta.targetName); break;
      case 'int': filterType = getOrCreateSharedFilter('Int', intFilterFields); break;
      default: filterType = getOrCreateSharedFilter('String', stringFilterFields);
    }
    filterFields[col.propertyName] = { type: filterType };
  }

  // Build relation filter fields (recursive with cycle guard)
  const rels = relationMap[meta.targetName] ?? {};
  for (const [relName, relInfo] of Object.entries(rels)) {
    const targetEntityName = relInfo.targetEntityName;
    if (visitedEntities.has(targetEntityName)) continue;
    visitedEntities.add(targetEntityName);
    const targetMeta = entityMap[targetEntityName];
    if (!targetMeta) { visitedEntities.delete(targetEntityName); continue; }
    const subFilter = generateRelationFilter(
      `${entityName}_${relName}`,
      targetMeta,
      entityMap,
      relationMap,
      visitedEntities,
      depthLimit,
      currentDepth + 1,
    );
    visitedEntities.delete(targetEntityName);
    if (subFilter) {
      filterFields[relName] = { type: subFilter };
    }
  }

  return new GraphQLInputObjectType({
    name: filterName,
    fields: () => {
      const orType = new GraphQLInputObjectType({
        name: `${filterName}_Or`,
        fields: () => ({ ...filterFields }),
      });
      return { ...filterFields, or: { type: new GraphQLList(new GraphQLNonNull(orType)) } };
    },
  });
}

// ──────────────────────────────────────────────
// Generate all entity types
// ──────────────────────────────────────────────

export function generateTypes(
  entityMetadatas: EntityMetadata[],
  entityMap: Record<string, EntityMetadata>,
  relationMap: RelationMap,
  typeNameMapper: TypeNameMapper,
  relationDepth = 2,
): {
  types: Record<string, GraphQLObjectType>;
  inputs: Record<string, GraphQLInputObjectType>;
  filters: Record<string, GraphQLInputObjectType>;
  orders: Record<string, GraphQLInputObjectType>;
  insertInputs: Record<string, GraphQLInputObjectType>;
  updateInputs: Record<string, GraphQLInputObjectType>;
} {
  const types: Record<string, GraphQLObjectType> = {};
  const inputs: Record<string, GraphQLInputObjectType> = {};
  const filters: Record<string, GraphQLInputObjectType> = {};
  const orders: Record<string, GraphQLInputObjectType> = {};
  const insertInputs: Record<string, GraphQLInputObjectType> = {};
  const updateInputs: Record<string, GraphQLInputObjectType> = {};

  for (const meta of entityMetadatas) {
    const names = resolveNames(meta.targetName, typeNameMapper);
    const bundle = buildTableTypes(meta, entityMap, relationMap, typeNameMapper, names, relationDepth);
    types[names.typeName] = bundle.outputType;
    insertInputs[meta.targetName] = bundle.insertInput;
    updateInputs[meta.targetName] = bundle.updateInput;
    filters[meta.targetName] = bundle.filterInput;
    orders[meta.targetName] = bundle.orderInput;
    inputs[bundle.insertInput.name] = bundle.insertInput;
    inputs[bundle.updateInput.name] = bundle.updateInput;
    inputs[bundle.filterInput.name] = bundle.filterInput;
    inputs[bundle.orderInput.name] = bundle.orderInput;
  }

  return { types, inputs, filters, orders, insertInputs, updateInputs };
}
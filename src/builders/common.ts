import type { EntityMetadata } from 'typeorm';
import type { DataSource } from 'typeorm';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { GraphQLDate, GraphQLDateTime } from 'graphql-scalars';
import { capitalize } from '../case-ops/index.ts';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM RelationMetadata type
  relation: any;
  isOne: boolean;
}

export type RelationMap = Record<string, Record<string, RelationInfo>>;

export function extractEntityMap(dataSource: DataSource): EntityMetadata[] {
  return dataSource.entityMetadatas;
}

export function buildRelationMap(metadataList: EntityMetadata[]): RelationMap {
  const map: RelationMap = {};
  for (const meta of metadataList) {
    const name = meta.targetName;
    const relations: Record<string, RelationInfo> = {};
    for (const relation of meta.relations) {
      if (relation.isTreeParent || relation.isTreeChildren) continue;
      if (relation.isLazy) continue;

      const isOne =
        relation.relationType === 'one-to-one' ||
        relation.relationType === 'many-to-one';
      relations[relation.propertyName] = {
        relationType: relation.relationType,
        isOwning: relation.isOwning,
        targetEntityName: relation.inverseEntityMetadata.targetName,
        relation,
        isOne,
      };
    }
    if (Object.keys(relations).length > 0) {
      map[name] = relations;
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
  fieldsFunction: () => Record<string, { type: GraphQLInputType }>,
): GraphQLInputObjectType {
  if (sharedFilters.has(name)) return sharedFilters.get(name)!;
  const main = new GraphQLInputObjectType({
    name: `${name}Filter`,
    fields: fieldsFunction,
  });
  sharedFilters.set(name, main);
  return main;
}

function stringFilterFields(): Record<string, { type: GraphQLInputType }> {
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

function intFilterFields(): Record<string, { type: GraphQLInputType }> {
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

function floatFilterFields(): Record<string, { type: GraphQLInputType }> {
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

function booleanFilterFields(): Record<string, { type: GraphQLInputType }> {
  return {
    eq: { type: GraphQLBoolean },
    ne: { type: GraphQLBoolean },
    isNull: { type: GraphQLBoolean },
    isNotNull: { type: GraphQLBoolean },
  };
}

function dateTimeFilterFields(): Record<string, { type: GraphQLInputType }> {
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

function dateFilterFields(): Record<string, { type: GraphQLInputType }> {
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

type ColumnFilterCategory =
  | 'string'
  | 'int'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum';

function classifyColumn(
  meta: EntityMetadata,
): (columnName: string) => ColumnFilterCategory {
  return (columnName: string) => {
    const columnMeta = meta.ownColumns.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ColumnMetadata from TypeORM
      (column: any) => column.propertyName === columnName,
    );
    if (!columnMeta) return 'string';
    const typeString = String(columnMeta.type).toLowerCase();

    // Handle constructor-based types (e.g., Number, Boolean, Date)
    if (columnMeta.type === Number) return 'int';
    if (columnMeta.type === Boolean) return 'boolean';
    if (columnMeta.type === String) return 'string';
    if (columnMeta.type === Date) return 'datetime';

    // Handle enum columns — check if enum is defined (TS enums, simple-enum, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM column metadata enum
    const columnEnum = (columnMeta as any).enum;
    if (columnEnum) {
      const keys = Object.keys(columnEnum);
      // Filter out reverse numeric mappings (TypeScript numeric enums)
      const values = keys.filter(
        (k) => Number.isNaN(Number(k)),
      );
      if (values.length > 0) return 'enum';
    }

    if (
      ['int', 'integer', 'smallint', 'mediumint', 'tinyint'].includes(
        typeString,
      )
    )
      return 'int';
    if (
      ['float', 'double', 'decimal', 'numeric', 'real', 'money'].includes(
        typeString,
      )
    )
      return 'float';
    if (
      ['boolean', 'bool'].includes(typeString) ||
      (typeString === 'tinyint' && columnMeta.length === '1')
    )
      return 'boolean';
    if (
      typeString.includes('timestamp') ||
      typeString === 'datetime' ||
      typeString === 'timestamptz'
    )
      return 'datetime';
    if (typeString === 'date') return 'date';
    return 'string';
  };
}

// ──────────────────────────────────────────────
// Field resolvers for relations (mutable, populated by resolvers.ts)
// ──────────────────────────────────────────────

export const relationResolvers = new Map<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver return type
  (source: unknown, args: unknown, context: unknown) => Promise<any>
>();

export function registerFieldResolver(
  entityName: string,
  relationName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver return type
  resolver: (source: unknown, args: unknown, context: unknown) => Promise<any>,
): void {
  relationResolvers.set(`${entityName}.${relationName}`, resolver);
}

// ── Relation filter/order cache for field arguments ──
export const relationFilterCache = new Map<string, GraphQLInputObjectType>();
export const relationOrderCache = new Map<string, GraphQLInputObjectType>();

// ── Shared Pagination type ──
export const paginationType = new GraphQLObjectType({
  name: 'Pagination',
  fields: {
    limit: { type: new GraphQLNonNull(GraphQLInt) },
    offset: { type: new GraphQLNonNull(GraphQLInt) },
    count: { type: new GraphQLNonNull(GraphQLInt) },
  },
});

// ── DeleteResult type ──
export const deleteResultType = new GraphQLObjectType({
  name: 'DeleteResult',
  fields: {
    affected: { type: new GraphQLNonNull(GraphQLInt) },
    raw: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
  },
});

export function hasSoftDeleteColumn(meta: EntityMetadata): boolean {
  return meta.columns.some((col) => col.isDeleteDate);
}

// ──────────────────────────────────────────────
// Type cache — one GraphQLObjectType per typeName
// Fields are deferred via thunks, so circular refs work.
// ──────────────────────────────────────────────

const typeCache = new Map<string, GraphQLObjectType>();
const typeMetaMap = new Map<
  string,
  { meta: EntityMetadata; relations: Record<string, RelationInfo> }
>();

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
  typeMetaMap.set(typeName, {
    meta,
    relations: relationMap[meta.targetName] ?? {},
  });

  const graphqlType = new GraphQLObjectType({
    name: typeName,
    fields: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config entries
      const fields: Record<string, any> = {};
      for (const column of meta.ownColumns) {
        const converted = typeormColumnToGraphQLType(
          column,
          meta.targetName,
          false,
        );
        fields[column.propertyName] = { type: converted.type };
      }
      const stored = typeMetaMap.get(typeName);
      const relations = stored?.relations ?? {};
      for (const [relationName, relationInfo] of Object.entries(relations)) {
        const info = relationInfo as RelationInfo;
        const targetMeta = entityMap[info.targetEntityName];
        if (!targetMeta) continue;
        const targetNames = resolveNames(info.targetEntityName, typeNameMapper);
        const targetType = buildOrGetType(
          targetNames.typeName,
          targetMeta,
          entityMap,
          relationMap,
          typeNameMapper,
        );
        const resolverKey = `${meta.targetName}.${relationName}`;
        const fieldResolver = relationResolvers.get(resolverKey);
        if (info.isOne) {
          fields[relationName] = { type: targetType, resolve: fieldResolver };
        } else {
          // List relation: add where/orderBy/limit/offset args
          const targetFilter = relationFilterCache.get(info.targetEntityName);
          const targetOrder = relationOrderCache.get(info.targetEntityName);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config entries
          const relationArgs: Record<string, any> = {};
          if (targetFilter) relationArgs['where'] = { type: targetFilter };
          if (targetOrder) relationArgs['orderBy'] = { type: targetOrder };
          relationArgs['limit'] = { type: GraphQLInt };
          relationArgs['offset'] = { type: GraphQLInt };
          fields[relationName] = {
            type: new GraphQLList(new GraphQLNonNull(targetType)),
            args: relationArgs,
            resolve: fieldResolver,
          };
        }
      }
      return fields;
    },
  });

  typeCache.set(typeName, graphqlType);
  return graphqlType;
}

export interface EntityTypeBundle {
  outputType: GraphQLObjectType;
  insertInput: GraphQLInputObjectType;
  updateInput: GraphQLInputObjectType;
  filterInput: GraphQLInputObjectType;
  orderInput: GraphQLInputObjectType;
  listResultType: GraphQLObjectType;
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
  const columns: EntityMetadata['ownColumns'] = meta.ownColumns;
  const classifyFunction = classifyColumn(meta);

  // Output type (via cache to handle circular refs)
  const outputType = buildOrGetType(
    typeName,
    meta,
    entityMap,
    relationMap,
    typeNameMapper,
  );

  // ── Insert input ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config entries
  const insertFields: Record<string, any> = {};
  for (const column of columns) {
    if (column.isGenerated && column.generationStrategy === 'increment')
      continue;
    const converted = typeormColumnToGraphQLType(column, entityName, true);
    insertFields[column.propertyName] = { type: converted.type };
  }
  const insertInput = new GraphQLInputObjectType({
    name: `Create${typeName}Input`,
    fields: insertFields,
  });

  // ── Update input ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config entries
  const updateFields: Record<string, any> = {};
  for (const column of columns) {
    if (column.isGenerated && column.generationStrategy === 'increment')
      continue;
    const converted = typeormColumnToGraphQLType(column, entityName, true);
    updateFields[column.propertyName] = { type: converted.type };
  }
  const updateInput = new GraphQLInputObjectType({
    name: `Update${typeName}Input`,
    fields: updateFields,
  });

  // ── Filter input ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config entries
  const filterFields: Record<string, any> = {};
  for (const column of columns) {
    const category = classifyFunction(column.propertyName);
    let filterType: GraphQLInputObjectType;
    switch (category) {
      case 'float':
        filterType = getOrCreateSharedFilter('Float', floatFilterFields);
        break;
      case 'boolean':
        filterType = getOrCreateSharedFilter('Boolean', booleanFilterFields);
        break;
      case 'date':
        filterType = getOrCreateSharedFilter('Date', dateFilterFields);
        break;
      case 'datetime':
        filterType = getOrCreateSharedFilter('DateTime', dateTimeFilterFields);
        break;
      case 'enum':
        filterType = makeEnumFilter(column, entityName);
        break;
      case 'int':
        filterType = getOrCreateSharedFilter('Int', intFilterFields);
        break;
      default:
        filterType = getOrCreateSharedFilter('String', stringFilterFields);
    }
    filterFields[column.propertyName] = { type: filterType };
  }

  // ── Relation filter fields ──
  const relations = relationMap[entityName] ?? {};
  if (relationDepth > 0) {
    const visitedEntities = new Set<string>([entityName]);
    for (const [relationName, relationInfo] of Object.entries(relations)) {
      const targetEntityName = relationInfo.targetEntityName;
      if (visitedEntities.has(targetEntityName)) continue;
      visitedEntities.add(targetEntityName);
      const targetMeta = entityMap[targetEntityName];
      if (!targetMeta) {
        visitedEntities.delete(targetEntityName);
        continue;
      }
      const subFilter = generateRelationFilter(
        `${typeName}_${relationName}`,
        targetMeta,
        entityMap,
        relationMap,
        visitedEntities,
        relationDepth,
        0,
      );
      visitedEntities.delete(targetEntityName);
      if (subFilter) {
        filterFields[relationName] = { type: subFilter };
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
      return {
        ...filterFields,
        or: { type: new GraphQLList(new GraphQLNonNull(orType)) },
      };
    },
  });
  relationFilterCache.set(entityName, filterInput);

  // ── Order input ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config entries
  const orderFields: Record<string, any> = {};
  for (const column of columns) {
    const directionEnum = new GraphQLEnumType({
      name: `${typeName}_${capitalize(column.propertyName)}_Direction`,
      values: { ASC: { value: 'ASC' }, DESC: { value: 'DESC' } },
    });
    orderFields[column.propertyName] = {
      type: new GraphQLInputObjectType({
        name: `${typeName}_${capitalize(column.propertyName)}_Order`,
        fields: {
          direction: { type: new GraphQLNonNull(directionEnum) },
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

    // ── List result type ──
  const listResultType = new GraphQLObjectType({
    name: `${typeName}ListResult`,
    fields: {
      rows: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(outputType))) },
      pagination: { type: new GraphQLNonNull(paginationType) },
    },
  });

  return {
    outputType,
    insertInput,
    updateInput,
    filterInput,
    orderInput,
    listResultType,
    relationFields: {},
  };
}

// ── Enum filter cache ──
const enumFilterCache = new Map<string, GraphQLInputObjectType>();

function makeEnumFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM ColumnMetadata
  column: any,
  entityName: string,
): GraphQLInputObjectType {
  const cacheKey = `${entityName}.${column.propertyName}`;
  const cached = enumFilterCache.get(cacheKey);
  if (cached) return cached;

  const graphqlType = typeormColumnToGraphQLType(column, entityName, false);
  const enumGraphqlType =
    graphqlType.type instanceof GraphQLEnumType
      ? graphqlType.type
      : GraphQLString;
  const filterName = `${entityName}_${capitalize(column.propertyName)}_EnumFilter`;
  const enumFilter = new GraphQLInputObjectType({
    name: filterName,
    fields: {
      eq: { type: enumGraphqlType },
      ne: { type: enumGraphqlType },
      in: { type: new GraphQLList(new GraphQLNonNull(enumGraphqlType)) },
      notIn: { type: new GraphQLList(new GraphQLNonNull(enumGraphqlType)) },
      isNull: { type: GraphQLBoolean },
      isNotNull: { type: GraphQLBoolean },
    },
  });
  enumFilterCache.set(cacheKey, enumFilter);
  return enumFilter;
}

// ── Recursive relation filter generator ──
function generateRelationFilter(
  filterNamePrefix: string,
  meta: EntityMetadata,
  entityMap: Record<string, EntityMetadata>,
  relationMap: RelationMap,
  visitedEntities: Set<string>,
  depthLimit: number,
  currentDepth: number,
): GraphQLInputObjectType | null {
  // Guard: depth limit
  if (currentDepth > depthLimit) return null;

  const filterName = `${filterNamePrefix}_RelationFilter`;
  const classifyFunction = classifyColumn(meta);
  const columns = meta.ownColumns;

  // Build scalar filter fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL field config entries
  const filterFields: Record<string, any> = {};
  for (const column of columns) {
    const category = classifyFunction(column.propertyName);
    let filterType: GraphQLInputObjectType;
    switch (category) {
      case 'float':
        filterType = getOrCreateSharedFilter('Float', floatFilterFields);
        break;
      case 'boolean':
        filterType = getOrCreateSharedFilter('Boolean', booleanFilterFields);
        break;
      case 'date':
        filterType = getOrCreateSharedFilter('Date', dateFilterFields);
        break;
      case 'datetime':
        filterType = getOrCreateSharedFilter('DateTime', dateTimeFilterFields);
        break;
      case 'enum':
        filterType = makeEnumFilter(column, meta.targetName);
        break;
      case 'int':
        filterType = getOrCreateSharedFilter('Int', intFilterFields);
        break;
      default:
        filterType = getOrCreateSharedFilter('String', stringFilterFields);
    }
    filterFields[column.propertyName] = { type: filterType };
  }

  // Build relation filter fields (recursive with cycle guard)
  const relations = relationMap[meta.targetName] ?? {};
  for (const [relationName, relationInfo] of Object.entries(relations)) {
    const targetEntityName = relationInfo.targetEntityName;
    if (visitedEntities.has(targetEntityName)) continue;
    visitedEntities.add(targetEntityName);
    const targetMeta = entityMap[targetEntityName];
    if (!targetMeta) {
      visitedEntities.delete(targetEntityName);
      continue;
    }
    const subFilter = generateRelationFilter(
      `${filterNamePrefix}_${relationName}`,
      targetMeta,
      entityMap,
      relationMap,
      visitedEntities,
      depthLimit,
      currentDepth + 1,
    );
    visitedEntities.delete(targetEntityName);
    if (subFilter) {
      filterFields[relationName] = { type: subFilter };
    }
  }

  return new GraphQLInputObjectType({
    name: filterName,
    fields: () => {
      const orType = new GraphQLInputObjectType({
        name: `${filterName}_Or`,
        fields: () => ({ ...filterFields }),
      });
      return {
        ...filterFields,
        or: { type: new GraphQLList(new GraphQLNonNull(orType)) },
      };
    },
  });
}

// ──────────────────────────────────────────────
// Generate all entity types
// ──────────────────────────────────────────────

export function generateTypes(
  metadataList: EntityMetadata[],
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
  listResultTypes: Record<string, GraphQLObjectType>;
} {
  const types: Record<string, GraphQLObjectType> = {};
  const inputs: Record<string, GraphQLInputObjectType> = {};
  const filters: Record<string, GraphQLInputObjectType> = {};
  const orders: Record<string, GraphQLInputObjectType> = {};
  const insertInputs: Record<string, GraphQLInputObjectType> = {};
  const updateInputs: Record<string, GraphQLInputObjectType> = {};
  const listResultTypes: Record<string, GraphQLObjectType> = {};

  for (const meta of metadataList) {
    const names = resolveNames(meta.targetName, typeNameMapper);
    const bundle = buildTableTypes(
      meta,
      entityMap,
      relationMap,
      typeNameMapper,
      names,
      relationDepth,
    );
    types[names.typeName] = bundle.outputType;
    insertInputs[meta.targetName] = bundle.insertInput;
    updateInputs[meta.targetName] = bundle.updateInput;
    filters[meta.targetName] = bundle.filterInput;
    orders[meta.targetName] = bundle.orderInput;
    listResultTypes[meta.targetName] = bundle.listResultType;
    inputs[bundle.insertInput.name] = bundle.insertInput;
    inputs[bundle.updateInput.name] = bundle.updateInput;
    inputs[bundle.filterInput.name] = bundle.filterInput;
    inputs[bundle.orderInput.name] = bundle.orderInput;
  }

  return { types, inputs, filters, orders, insertInputs, updateInputs, listResultTypes };
}

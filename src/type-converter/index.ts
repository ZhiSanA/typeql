import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLScalarType,
  GraphQLString,
} from 'graphql';
import { GraphQLDate, GraphQLDateTime } from 'graphql-scalars';
import { capitalize } from '../case-ops/index.ts';
import type { ConvertedColumn } from './types.ts';

// Minimal ColumnMetadata type — we only use these properties
interface ColumnLike {
  propertyName: string;
  type: unknown;
  isPrimary: boolean;
  isGenerated: boolean;
  isNullable: boolean;
  enum?: (string | number)[];
  length: string;
  isArray: boolean;
  generationStrategy?: string;
}

const enumMap = new WeakMap<object, GraphQLEnumType>();

function generateEnumType(
  column: ColumnLike,
  entityName: string,
): GraphQLEnumType {
  if (enumMap.has(column)) {
    return enumMap.get(column)!;
  }

  const enumValues = column.enum ?? [];
  const values: Record<string, { value: string | number }> = {};
  for (const enumValue of enumValues) {
    const key = String(enumValue).replace(/[^a-zA-Z0-9_]/g, '_');
    values[key] = { value: enumValue };
  }

  const gqlEnum = new GraphQLEnumType({
    name: `${capitalize(entityName)}${capitalize(column.propertyName)}Enum`,
    values,
  });

  enumMap.set(column, gqlEnum);
  return gqlEnum;
}

function isIntegerType(colType: unknown): boolean {
  // colType can be a string like "integer" or a constructor like Number
  if (colType === Number) return true;
  const typeString = String(colType).toLowerCase();
  return [
    'int',
    'integer',
    'int4',
    'smallint',
    'mediumint',
    'tinyint',
    'int2',
    'number',
  ].includes(typeString);
}

function isFloatType(colType: unknown): boolean {
  if (colType === Number) return false; // Number is int, not float
  const typeString = String(colType).toLowerCase();
  return [
    'float',
    'double',
    'decimal',
    'numeric',
    'real',
    'money',
    'dec',
    'double precision',
  ].includes(typeString);
}

function isTimestampType(colType: unknown): boolean {
  if (colType === Date) return true;
  const s = String(colType).toLowerCase();
  return s.includes('timestamp') || ['datetime', 'timestamptz'].includes(s);
}

function resolveScalarType(
  typeStr: unknown,
  column: ColumnLike,
): { type: GraphQLScalarType | GraphQLEnumType; description?: string } {
  if (typeof typeStr !== 'string') {
    return { type: GraphQLString, description: 'String' };
  }
  if (isIntegerType(typeStr)) {
    if (typeStr === 'tinyint' && column.length === '1') {
      return { type: GraphQLBoolean };
    }
    return { type: GraphQLInt };
  }
  if (isFloatType(typeStr)) {
    return { type: GraphQLFloat };
  }
  if (['boolean', 'bool'].includes(typeStr)) {
    return { type: GraphQLBoolean };
  }
  if (isTimestampType(typeStr)) {
    return { type: GraphQLDateTime, description: 'DateTime' };
  }
  if (typeStr === 'date') {
    return { type: GraphQLDate, description: 'Date' };
  }
  if (['time', 'timetz'].includes(typeStr)) {
    return { type: GraphQLString, description: 'Time' };
  }
  if (['json', 'jsonb', 'simple-json'].includes(typeStr)) {
    return { type: GraphQLString, description: 'JSON' };
  }
  if (['uuid'].includes(typeStr)) {
    return { type: GraphQLString, description: 'UUID' };
  }
  if (['bigint', 'int8'].includes(typeStr)) {
    return { type: GraphQLString, description: 'BigInt' };
  }
  if (
    ['bytea', 'blob', 'tinyblob', 'mediumblob', 'longblob'].includes(typeStr)
  ) {
    return { type: GraphQLString, description: 'Binary' };
  }
  if (['simple-array'].includes(typeStr)) {
    return { type: GraphQLString, description: 'SimpleArray' };
  }
  if (['varbinary', 'binary'].includes(typeStr)) {
    return { type: GraphQLString, description: 'Binary' };
  }
  if (['geometry', 'geography'].includes(typeStr)) {
    return { type: GraphQLString, description: 'Geometry' };
  }
  if (['inet', 'cidr', 'macaddr'].includes(typeStr)) {
    return { type: GraphQLString, description: 'Network' };
  }

  return { type: GraphQLString, description: 'String' };
}

/**
 * Maps a TypeORM column (or column-like object) to a GraphQL type.
 */
export function typeormColumnToGraphQLType(
  column: ColumnLike,
  entityName: string,
  isInput: boolean,
): ConvertedColumn {
  const rawType = column.type;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Intermediate union type holding GraphQLType families, cast to ConvertedColumn at return
  let baseResult: { type: any; description?: string };

  if (column.enum && column.enum.length > 0) {
    baseResult = { type: generateEnumType(column, entityName) };
  } else if (column.isArray) {
    const inner = resolveScalarType(rawType, column);

    baseResult = {
      type: new GraphQLList(new GraphQLNonNull(inner.type)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQLList not assignable to the intermediate union
    } as any;
  } else if (rawType === Number) {
    baseResult = { type: GraphQLInt };
  } else if (rawType === Boolean) {
    baseResult = { type: GraphQLBoolean };
  } else if (rawType === Date) {
    baseResult = { type: GraphQLDateTime, description: 'DateTime' };
  } else if (rawType === String) {
    baseResult = { type: GraphQLString, description: 'String' };
  } else {
    const typeStr = String(rawType).toLowerCase();
    baseResult = resolveScalarType(typeStr, column);
  }

  const isGenerated = column.isGenerated;
  const isPrimary = column.isPrimary;
  const forceNonNull =
    !isInput && (isPrimary || (!column.isNullable && !isGenerated));
  const makeNullable = isInput && (isGenerated || (isPrimary && isGenerated));

  if (isInput && makeNullable) {
    return baseResult as ConvertedColumn;
  }
  if (forceNonNull) {
    return {
      type: new GraphQLNonNull(baseResult.type),
      description: baseResult.description,
    } as ConvertedColumn;
  }

  return baseResult as ConvertedColumn;
}

import { GraphQLError } from 'graphql';

// Minimal column interface matching what we use
interface ColumnLike {
  propertyName: string;
  type: any;
  isNullable: boolean;
  isGenerated: boolean;
}

export const remapToGraphQLCore = (value: any, _column?: ColumnLike): any => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value;
  }
  return value;
};

export const remapToGraphQLSingleOutput = (
  entity: Record<string, any>,
): Record<string, any> => {
  for (const [key, value] of Object.entries(entity)) {
    if (value === undefined || value === null) {
      delete entity[key];
      continue;
    }
    entity[key] = remapToGraphQLCore(value);
  }
  return entity;
};

export const remapToGraphQLArrayOutput = (
  entities: Record<string, any>[],
): Record<string, any>[] => {
  for (const entry of entities) {
    remapToGraphQLSingleOutput(entry);
  }
  return entities;
};

export const remapFromGraphQLCore = (value: any, column: ColumnLike): any => {
  const typeStr = String(column.type).toLowerCase();

  if (typeStr.includes('timestamp') || typeStr === 'datetime' || typeStr === 'timestamptz') {
    if (typeof value === 'string') {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new GraphQLError(`Invalid date value for column "${column.propertyName}"`);
      }
      return d;
    }
    return value;
  }

  if (typeStr === 'date') {
    if (typeof value === 'string') {
      const dateOnly = value.includes('T') ? value.split('T')[0]! : value;
      const d = new Date(dateOnly);
      if (Number.isNaN(d.getTime())) {
        throw new GraphQLError(`Invalid date value for column "${column.propertyName}"`);
      }
      return dateOnly;
    }
    return value;
  }

  if (typeStr === 'bigint' || typeStr === 'int8') {
    if (typeof value === 'string') {
      try {
        return BigInt(value);
      } catch {
        throw new GraphQLError(`Invalid BigInt value for column "${column.propertyName}"`);
      }
    }
    return value;
  }

  if (typeStr === 'json' || typeStr === 'jsonb') {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (e: any) {
        throw new GraphQLError(`Invalid JSON for column "${column.propertyName}": ${e.message}`);
      }
    }
    return value;
  }

  if (typeStr === 'simple-json') {
    if (value !== null && typeof value !== 'string') {
      return JSON.stringify(value);
    }
    return value;
  }

  if (typeStr === 'simple-array') {
    if (Array.isArray(value)) {
      return value.join(',');
    }
    return value;
  }

  return value;
};

export const remapFromGraphQLSingleInput = (
  input: Record<string, any>,
  columns: ColumnLike[],
): Record<string, any> => {
  const colMap = new Map(columns.map((c) => [c.propertyName, c]));
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      delete input[key];
      continue;
    }
    const column = colMap.get(key);
    if (!column) {
      throw new GraphQLError(`Unknown column: "${key}"`);
    }
    if (value === null && column.isNullable === false && !column.isGenerated) {
      delete input[key];
      continue;
    }
    input[key] = remapFromGraphQLCore(value, column);
  }
  return input;
};

export const remapFromGraphQLArrayInput = (
  inputs: Record<string, any>[],
  columns: ColumnLike[],
): Record<string, any>[] => {
  for (const entry of inputs) {
    remapFromGraphQLSingleInput(entry, columns);
  }
  return inputs;
};
import { GraphQLError } from 'graphql';

// Minimal column interface matching what we use
interface ColumnLike {
  propertyName: string;
  type: unknown;
  isNullable: boolean;
  isGenerated: boolean;
}

export const remapToGraphQLCore = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  return value;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
export const remapToGraphQLSingleOutput = (
  entity: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
export const remapToGraphQLArrayOutput = (
  entities: Record<string, any>[], // eslint-disable-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
): Record<string, any>[] => {
  for (const entry of entities) {
    remapToGraphQLSingleOutput(entry);
  }
  return entities;
};

export const remapFromGraphQLCore = (
  value: unknown,
  column: ColumnLike,
): unknown => {
  const typeString = String(column.type).toLowerCase();

  if (
    typeString.includes('timestamp') ||
    typeString === 'datetime' ||
    typeString === 'timestamptz'
  ) {
    if (typeof value === 'string') {
      const dateObject = new Date(value);
      if (Number.isNaN(dateObject.getTime())) {
        throw new GraphQLError(
          `Invalid date value for column "${column.propertyName}"`,
        );
      }
      return dateObject;
    }
    return value;
  }

  if (typeString === 'date') {
    if (typeof value === 'string') {
      const dateOnly = value.includes('T') ? value.split('T')[0]! : value;
      const dateObject = new Date(dateOnly);
      if (Number.isNaN(dateObject.getTime())) {
        throw new GraphQLError(
          `Invalid date value for column "${column.propertyName}"`,
        );
      }
      return dateOnly;
    }
    return value;
  }

  if (typeString === 'bigint' || typeString === 'int8') {
    if (typeof value === 'string') {
      try {
        return BigInt(value);
      } catch {
        throw new GraphQLError(
          `Invalid BigInt value for column "${column.propertyName}"`,
        );
      }
    }
    return value;
  }

  if (typeString === 'json' || typeString === 'jsonb') {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error: unknown) {
        throw new GraphQLError(
          `Invalid JSON for column "${column.propertyName}": ${(error as Error).message}`,
        );
      }
    }
    return value;
  }

  if (typeString === 'simple-json') {
    if (value !== null && typeof value !== 'string') {
      return JSON.stringify(value);
    }
    return value;
  }

  if (typeString === 'simple-array') {
    if (Array.isArray(value)) {
      return value.join(',');
    }
    return value;
  }

  return value;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
export const remapFromGraphQLSingleInput = (
  input: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
  columns: ColumnLike[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
): Record<string, any> => {
  const columnMap = new Map(
    columns.map((column) => [column.propertyName, column]),
  );
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      delete input[key];
      continue;
    }
    const column = columnMap.get(key);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
export const remapFromGraphQLArrayInput = (
  inputs: Record<string, any>[], // eslint-disable-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
  columns: ColumnLike[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Entity property values from TypeORM are dynamic
): Record<string, any>[] => {
  for (const entry of inputs) {
    remapFromGraphQLSingleInput(entry, columns);
  }
  return inputs;
};

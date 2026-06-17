import type { GraphQLInputObjectType } from 'graphql';

export interface TableGeneratedTypes {
  insertInput: GraphQLInputObjectType;
  updateInput: GraphQLInputObjectType;
  tableFilters: GraphQLInputObjectType;
  tableOrder: GraphQLInputObjectType;
}

export interface CreatedResolver {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL resolver return types are dynamic
  resolver: (...args: unknown[]) => Promise<any>;
  args: Record<string, GraphQLInputObjectType>;
}

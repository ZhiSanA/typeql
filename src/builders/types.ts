export interface TableGeneratedTypes {
  insertInput: any;
  updateInput: any;
  tableFilters: any;
  tableOrder: any;
}

export interface CreatedResolver {
  name: string;
  resolver: (...args: any[]) => Promise<any>;
  args: Record<string, any>;
}
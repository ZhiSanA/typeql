import { capitalize, uncapitalize } from '../case-ops/index.ts';

export type TypeNameMapper = (
  name: string,
) => { singular: string; plural: string } | undefined;

export interface ResolvedNames {
  typeName: string;
  listFieldName: string;
  singleFieldName: string;
  createArrayFieldName: string;
  createSingleFieldName: string;
  updateFieldName: string;
  deleteFieldName: string;
}

export function resolveNames(
  entityName: string,
  prefixes: { insert: string; update: string; delete: string },
  suffixes: { list: string; single: string },
  typeNameMapper?: TypeNameMapper,
): ResolvedNames {
  const mapped = typeNameMapper?.(entityName);
  const typeName = mapped ? capitalize(mapped.singular) : capitalize(entityName);
  const listFieldName = (mapped?.plural ?? uncapitalize(entityName)) + suffixes.list;
  const singleFieldName = mapped?.singular ?? uncapitalize(entityName) + suffixes.single;
  const createArrayFieldName = `${prefixes.insert}${mapped ? capitalize(mapped.plural) : capitalize(entityName)}`;
  const createSingleFieldName = mapped
    ? `${prefixes.insert}${capitalize(mapped.singular)}`
    : `${prefixes.insert}${capitalize(entityName)}${suffixes.single}`;
  const updateFieldName = `${prefixes.update}${mapped ? capitalize(mapped.singular) : capitalize(entityName)}`;
  const deleteFieldName = `${prefixes.delete}${mapped ? capitalize(mapped.singular) : capitalize(entityName)}`;

  return {
    typeName,
    listFieldName,
    singleFieldName,
    createArrayFieldName,
    createSingleFieldName,
    updateFieldName,
    deleteFieldName,
  };
}

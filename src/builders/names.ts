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
  softDeleteFieldName: string;
  restoreFieldName: string;
}

export function resolveNames(
  entityName: string,
  typeNameMapper?: TypeNameMapper,
): ResolvedNames {
  const mapped = typeNameMapper?.(entityName);
  const typeName = mapped
    ? capitalize(mapped.singular)
    : capitalize(entityName);
  const listFieldName = mapped?.plural ?? uncapitalize(entityName);
  const singleFieldName = mapped?.singular ?? uncapitalize(entityName);
  const createArrayFieldName = `create${mapped ? capitalize(mapped.plural) : capitalize(entityName)}`;
  const createSingleFieldName = `create${mapped ? capitalize(mapped.singular) : capitalize(entityName)}`;
  const updateFieldName = `update${mapped ? capitalize(mapped.singular) : capitalize(entityName)}`;
  const deleteFieldName = `delete${mapped ? capitalize(mapped.singular) : capitalize(entityName)}`;
  const softDeleteFieldName = `softDelete${mapped ? capitalize(mapped.singular) : capitalize(entityName)}`;
  const restoreFieldName = `restore${mapped ? capitalize(mapped.singular) : capitalize(entityName)}`;

  return {
    typeName,
    listFieldName,
    singleFieldName,
    createArrayFieldName,
    createSingleFieldName,
    updateFieldName,
    deleteFieldName,
    softDeleteFieldName,
    restoreFieldName,
  };
}

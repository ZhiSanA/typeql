# @jishu.xin/typeql

Auto-generate GraphQL schema from TypeORM entities — inspired by [drizzle-graphql](https://github.com/vantreeseba/drizzle-graphql).

## Install

```bash
npm install @jishu.xin/typeql
```

**Peer dependencies:** `typeorm`, `graphql`, `graphql-scalars`

## Quick Start

```typescript
import "reflect-metadata";
import { DataSource, Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import { buildSchema } from "@jishu.xin/typeql";

@Entity()
class User {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column("text")
  name!: string;
}

const dataSource = new DataSource({
  type: "better-sqlite3",
  database: ":memory:",
  entities: [User],
  synchronize: true,
});

await dataSource.initialize();

const { schema, entities } = buildSchema(dataSource);
// `schema` is a standard GraphQLSchema — use with Apollo, Yoga, etc.
```

## Generated API

For an entity `User`, the following operations are generated:

### Queries

| Field | Type | Args |
|---|---|---|
| `user` | `[User!]!` | `where`, `orderBy`, `offset`, `limit` |
| `userSingle` | `User` | `where`, `orderBy`, `offset` |

### Mutations

| Field | Type | Args |
|---|---|---|
| `createUser` | `[User!]!` | `values: [CreateUserInput!]!` |
| `createUserSingle` | `User` | `values: CreateUserInput!` |
| `updateUser` | `[User!]!` | `set: UpdateUserInput!`, `where` |
| `deleteUser` | `[User!]!` | `where` |

### Naming with typeNameMapper

Use `pluralize` to automatically handle singular/plural naming:

```typescript
import pluralize from "pluralize";

const { schema } = buildSchema(dataSource, {
  typeNameMapper: (name) => ({
    singular: pluralize.singular(name),
    plural: pluralize.plural(name),
  }),
  suffixes: { list: "", single: "" },
});
```

With this config:
- Entity `User` → queries `users` (list) / `user` (single), mutations `createUsers` / `createUser` / `updateUser` / `deleteUser`
- Entity `Post` → queries `posts` (list) / `post` (single), mutations `createPosts` / `createPost` / `updatePost` / `deletePost`

## Filter System

Each column gets filter operators based on its type:

| Operators | Column Types |
|---|---|
| `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `notIn`, `isNull`, `isNotNull` | int, float |
| `eq`, `ne`, `like`, `notLike`, `ilike`, `notIlike`, `in`, `notIn`, `isNull`, `isNotNull` | string |
| `eq`, `ne`, `isNull`, `isNotNull` | boolean, enum |
| `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `notIn`, `isNull`, `isNotNull` | date, datetime |

OR combinator:

```graphql
{
  users(where: { OR: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) {
    id name
  }
}
```

## OrderBy

```graphql
{
  users(orderBy: { name: { direction: ASC, priority: 1 } }) {
    id name
  }
}
```

## Pagination

```graphql
{
  users(limit: 10, offset: 0) {
    id name
  }
}
```

## Relations

TypeORM relations (OneToOne, ManyToOne, OneToMany, ManyToMany) are automatically resolved with N+1 batch loading:

```graphql
{
  posts { id title author { id name } }
  users { id name posts { id title } }
}
```

## Config

### BuildSchemaConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `mutations` | `boolean` | `true` | Set to `false` to omit the Mutation type |
| `prefixes` | `{ insert?, update?, delete? }` | `{ insert: 'create', update: 'update', delete: 'delete' }` | Mutation field name prefixes |
| `suffixes` | `{ list?, single? }` | `{ list: '', single: 'Single' }` | Query field name suffixes |
| `typeNameMapper` | `(entityName) => { singular, plural } \| undefined` | — | Custom singular/plural naming |
| `relationsDepthLimit` | `number` | `undefined` (unlimited) | Limit relation recursion depth |

## Architecture

```
src/
  index.ts              # Public entry: re-exports buildSchema + types
  types.ts              # Public type definitions
  buildSchema.ts        # buildSchema() orchestration
  util/
    case-ops/           # String utilities (capitalize, uncapitalize, singularize)
    type-converter/     # TypeORM column type → GraphQL scalar mapping
    builders/
      common.ts         # Metadata extraction, type/input/filter/order generation
      names.ts          # Field name resolution
      resolvers.ts      # CRUD + relation resolvers
      types.ts          # Internal types
    data-mappers/       # Row data ↔ GraphQL value transformations
    batch-loader/       # Request-scoped N+1 batch loading
```
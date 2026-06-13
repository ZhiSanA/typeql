# @jishu.xin/typeql

Auto-generate GraphQL schema from TypeORM entities — inspired by [drizzle-graphql](https://github.com/vantreeseba/drizzle-graphql).

## Usage

```typescript
import "reflect-metadata";
import { DataSource, Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import { buildSchema } from "@jishu.xin/typeql";
import { createYoga } from "graphql-yoga";
import { createServer } from "node:http";

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

// schema is a standard GraphQLSchema — use it with any GraphQL server
const yoga = createYoga({ schema });
const server = createServer(yoga);
server.listen(4000);
```

## Generated API

For an entity `User`, generates:

| Operation | Field | Args |
|---|---|---|
| List query | `user` | `where`, `orderBy`, `offset`, `limit` |
| Single query | `userSingle` | `where`, `orderBy`, `offset` |
| Create array | `createUser` | `values: [CreateUserInput!]!` |
| Create single | `createUserSingle` | `values: CreateUserInput!` |
| Update | `updateUser` | `set: UpdateUserInput!`, `where` |
| Delete | `deleteUser` | `where` |

## Filter Operators

Per-column filters: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `like`, `notLike`, `ilike`, `notIlike`, `in`, `notIn`, `isNull`, `isNotNull`. Top-level `or` combinator for OR conditions.

## Install

```bash
npm install @jishu.xin/typeql
```

**Peer dependencies:** `typeorm`, `graphql`, `graphql-scalars`

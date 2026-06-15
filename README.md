# TypeQL

Auto-generate GraphQL schema from TypeORM entities — inspired by [drizzle-graphql](https://github.com/vantreeseba/drizzle-graphql).

## Quick Start

```typescript
import "reflect-metadata";
import { DataSource, Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import { buildSchema } from "@jishu.xin/typeql";

@Entity()
class User {
  @PrimaryGeneratedColumn() id!: number;
  @Column("text") name!: string;
}

const ds = new DataSource({
  type: "better-sqlite3", database: ":memory:",
  entities: [User], synchronize: true,
});
await ds.initialize();

const { schema } = buildSchema(ds);
// Use schema with Apollo Server, GraphQL Yoga, etc.
```

## Naming

Default uses `pluralize` internally:

| Entity | List query | Single query | Create | Update | Delete |
|---|---|---|---|---|---|
| `User` | `users` | `user` | `createUsers`/`createUser` | `updateUser` | `deleteUser` |
| `Post` | `posts` | `post` | `createPosts`/`createPost` | `updatePost` | `deletePost` |

Override with `typeNameMapper`:

```typescript
buildSchema(ds, {
  typeNameMapper: (name) =>
    name === 'Person'
      ? { singular: 'person', plural: 'people' }
      : undefined,
});
```

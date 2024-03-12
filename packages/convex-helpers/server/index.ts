import {
  defineTable,
  QueryBuilder,
  MutationBuilder,
  GenericDataModel,
  WithoutSystemFields,
  DocumentByName,
  RegisteredMutation,
  RegisteredQuery,
  FunctionVisibility,
  paginationOptsValidator,
  PaginationResult,
} from "convex/server";
import { GenericId, Infer, ObjectType, Validator, v } from "convex/values";
import { Expand } from "..";

/**
 * Define a table with system fields _id and _creationTime. This also returns
 * helpers for working with the table in validators. See:
 * https://stack.convex.dev/argument-validation-without-repetition#table-helper-for-schema-definition--validation
 *
 * @param name The table name. This should also be used in defineSchema.
 * @param fields Table fields, as you'd pass to defineTable.
 * @returns Object of shape: {
 *   table: from defineTable,
 *   withSystemFields: Input fields with _id and _creationTime,
 *   withoutSystemFields: The fields passed in,
 *   doc: a validator for the table doc as a v.object(). This is useful when
 *     defining arguments to actions where you're passing whole documents.
 * }
 */
export function Table<
  T extends Record<string, Validator<any, any, any>>,
  TableName extends string
>(name: TableName, fields: T) {
  const table = defineTable(fields);
  const _id = v.id(name);
  const systemFields = {
    _id,
    _creationTime: v.number(),
  };

  const withSystemFields = {
    ...fields,
    ...systemFields,
  } as Expand<T & typeof systemFields>;
  return {
    name,
    table,
    doc: v.object(withSystemFields),
    withoutSystemFields: fields,
    withSystemFields,
    systemFields,
    _id,
  };
}

/**
 *
 * @param envVarName - The missing environment variable, e.g. OPENAI_API_KEY
 * @param whereToGet - Where to get it, e.g. "https://platform.openai.com/account/api-keys"
 * @returns A string with instructions on how to set the environment variable.
 */
export function missingEnvVariableUrl(envVarName: string, whereToGet: string) {
  const deployment = deploymentName();
  if (!deployment) return `Missing ${envVarName} in environment variables.`;
  return (
    `\n  Missing ${envVarName} in environment variables.\n\n` +
    `  Get it from ${whereToGet} .\n  Paste it on the Convex dashboard:\n` +
    `  https://dashboard.convex.dev/d/${deployment}/settings/environment-variables?var=${envVarName}`
  );
}

/**
 * Get the deployment name from the CONVEX_CLOUD_URL environment variable.
 * @returns The deployment name, like "screaming-lemur-123"
 */
export function deploymentName() {
  const url = process.env.CONVEX_CLOUD_URL;
  if (!url) return undefined;
  const regex = new RegExp("https://(.+).convex.cloud");
  return regex.exec(url)?.[1];
}

import { partial } from "../validators";

/**
 * Create CRUD operations for a table.
 * You can expose these operations in your API. For example, in convex/users.ts:
 *
 * ```ts
 * // in convex/users.ts
 * import { crud } from "convex-helpers/server";
 * import { query, mutation } from "./convex/_generated/server";
 *
 * const Users = Table("users", {
 *  name: v.string(),
 *  ///...
 * });
 *
 * export const { create, read, paginate, update, destroy } =
 *   crud(Users, query, mutation);
 * ```
 *
 * Then from a client, you can access `api.users.create`.
 *
 * @param table The table to create CRUD operations for.
 * Of type returned from Table() in "convex-helpers/server".
 * @param query The query to use - use internalQuery or query from
 * "./convex/_generated/server" or a customQuery.
 * @param mutation The mutation to use - use internalMutation or mutation from
 * "./convex/_generated/server" or a customMutation.
 * @returns An object with create, read, update, and delete functions.
 */
export function crud<
  Fields extends Record<string, Validator<any, any, any>>,
  TableName extends string,
  DataModel extends GenericDataModel,
  QueryVisibility extends FunctionVisibility,
  MutationVisibility extends FunctionVisibility
>(
  table: {
    name: TableName;
    _id: Validator<GenericId<TableName>>;
    withoutSystemFields: Fields;
  },
  query: QueryBuilder<DataModel, QueryVisibility>,
  mutation: MutationBuilder<DataModel, MutationVisibility>
) {
  return {
    create: mutation({
      args: table.withoutSystemFields,
      handler: async (ctx, args) => {
        const id = await ctx.db.insert(
          table.name,
          args as unknown as WithoutSystemFields<
            DocumentByName<DataModel, TableName>
          >
        );
        return (await ctx.db.get(id))!;
      },
    }) as RegisteredMutation<
      MutationVisibility,
      ObjectType<Fields>,
      Promise<DocumentByName<DataModel, TableName>>
    >,
    read: query({
      args: { id: table._id },
      handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
      },
    }) as RegisteredQuery<
      QueryVisibility,
      { id: GenericId<TableName> },
      Promise<DocumentByName<DataModel, TableName> | null>
    >,
    paginate: query({
      args: {
        paginationOpts: paginationOptsValidator,
      },
      handler: async (ctx, args) => {
        return ctx.db.query(table.name).paginate(args.paginationOpts);
      },
    }) as RegisteredQuery<
      QueryVisibility,
      { paginationOpts: Infer<typeof paginationOptsValidator> },
      Promise<PaginationResult<DocumentByName<DataModel, TableName>>>
    >,
    update: mutation({
      args: {
        id: v.id(table.name),
        patch: v.object(partial(table.withoutSystemFields)),
      },
      handler: async (ctx, args) => {
        await ctx.db.patch(
          args.id,
          args.patch as Partial<DocumentByName<DataModel, TableName>>
        );
      },
    }) as RegisteredMutation<
      MutationVisibility,
      {
        id: GenericId<TableName>;
        patch: Partial<
          WithoutSystemFields<DocumentByName<DataModel, TableName>>
        >;
      },
      Promise<void>
    >,
    destroy: mutation({
      args: { id: table._id },
      handler: async (ctx, args) => {
        const old = await ctx.db.get(args.id);
        if (old) {
          await ctx.db.delete(args.id);
        }
        return old;
      },
    }) as RegisteredMutation<
      MutationVisibility,
      { id: GenericId<TableName> },
      Promise<null | DocumentByName<DataModel, TableName>>
    >,
  };
}

export type JSONValue =
  | null
  | boolean
  | undefined
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * Returns a Response object with the data as JSON and
 * correct Content-Type header, for use with httpAction.
 *
 * Used like:
 * ```ts
 * http.route({
 *   path: "/templates",
 *   method: "GET",
 *   handler: httpAction(async (ctx) => {
 *     // ...
 *     return json({ message: "Hello, world!" });
 *   }),
 * });
 * ```
 *
 * @param data The data you want to return as JSON.
 * @returns A Response object with the data as JSON.
 */
export function json(data: JSONValue) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

var mysql = require("mysql2");
var esprima = require("esprima");
var config = require("../config");

interface Object {
    getClassName(): string;
}

Object.prototype.getClassName = function () {
    //var funcNameRegex = /function (.{1,})\(/;
    //var results = (funcNameRegex).exec((this).constructor.toString());
    //return (results && results.length > 1) ? results[1] : "";

    return (<any> this).constructor.name;
};

class FunctionQueueContext {
    success: () => void;
    fail: () => void;
}

class FunctionQueue {
    constructor() {
        this.items = [];
    }

    private items: Array<(FunctionQueueContext) => void>;
    private busy: boolean;

    add(callback: (context: FunctionQueueContext) => void) {

        this.items.push(callback);
        this.schedule();
    }

    schedule() {
        if (!this.busy) {
            if (this.items.length > 0) {
                try {
                    var item = this.items.shift();
                    var context = new FunctionQueueContext();
                    context.success = () => {
                        this.busy = false;
                        this.schedule();
                    };
                    context.fail = () => {
                        this.busy = false;
                        this.schedule();
                    };
                    this.busy = true;
                    item.call(this, context);
                } catch (error) {
                    console.error(error);
                }
            }
        }
    }
}

interface DbConfig {
    host: string,
    user: string,
    password: string,
    database: string
}

class Database {
    constructor(config: DbConfig) {
        this.connection = mysql.createConnection(config);
    }

    protected connection;

    connect() {
        return new Promise((resolve, reject) => {
            this.connection.connect((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    end() {
        return new Promise((resolve, reject) => {
            this.connection.end((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    query<T>(text, row): Promise<T> {
        var connection = this.connection;
        if (typeof row !== 'undefined') {
            return new Promise((resolve, reject) => {
                connection.query(text, row, (err, result, fields) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            });
        } else {
            return new Promise((resolve, reject) => {
                connection.query(text, (err, result, fields) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            });
        }
    }

    querySync<T>(text, row): T {
        var connection = this.connection;
        //if (typeof row !== 'undefined') {
        //    connection.query(text, row, (err, result, fields) => {
        //        if (err) {
        //            e = err;
        //        } else {
        //            r = result;
        //        }
        //    });
        //} else {
        //    connection.query(text, (err, result, fields) => {
        //        if (err) {
        //            e = err;
        //        } else {
        //            r = result;
        //        }
        //    });
        //}
        //while (typeof e === "undefined" || typeof r === "undefined") {
            
        //}
        //if (typeof e === "undefined") {
        //    throw e;
        //}
        return null;//r;
    }

    escape(text) {
        return mysql.escape(text);
    }
}

class DbQuery<T> /* implements Iterable<T> */ {
    constructor(source) {
        this.source = source;
        this.name = "";
    }

    protected name: string;

    protected source: any;

    where(predicate: ((item: T) => boolean) | string) {
        if (predicate instanceof Function) {

        }
        return new WhereQuery<T>(this, predicate);
    }

    orderBy<TKey>(keySelector: ((item: T) => TKey) | string) {
        return new OrderByQuery<T>(this, keySelector, false);
    }

    orderByDesc<TKey>(keySelector: ((item: T) => TKey) | string) {
        return new OrderByQuery<T>(this, keySelector, true);
    }

    select<T2>(selector: ((item: T) => T2) | string | string[]) {
        return new SelectQuery<T, T2>(this, selector);
    }

    async first(predicate?: ((item: T) => boolean) | string) {
        var query = new FirstQuery(this, predicate);
        var sql = Translator.translate(query);
        var context = this.getContext();
        var result = await context.query<T>(sql);
        return <T><any>result[0];
    }

    join<TInner, TKey, TResult>(
        inner: DbSet<TInner>,
        outerKeySelector: (item: T) => TKey,
        innerKeySelector: (item: TInner) => TKey,
        resultSelector: (arg1: T, arg2: TInner) => TResult): JoinQuery<TResult, TInner, TKey> {
        return new JoinQuery<TResult, TInner, TKey>(this, inner, outerKeySelector, innerKeySelector, resultSelector);
    }

    toArray(): Promise<T[]> {
        var sql = Translator.translate(this);
        console.log(sql);
        var context = this.getContext();
        return context.query<T>(sql);
    }

    protected getContext(): DbContext {
        var r = this;
        if (this.source !== null) {
            r = this.source.getContext();
        }
        return <DbContext><any>r;
    }

    protected getModel(): any {
        return this.getContext().model;
    }

    //[Symbol.iterator] () {
    //    var sql = Translator.translate(this);
    //    console.log(sql);
    //    var context = this.getContext();
    //    var items = context.querySync<T[]>(sql);
    //    var i = 0;
    //    return {
    //        next() {
    //            if (i < items.length) {
    //                var value = items[i++];
    //                return { done: false, value: value };
    //            } else {
    //                return { done: true };
    //            }
    //        }
    //    }
    //}

    protected iterate() {
        var sql = Translator.translate(this);
        console.log(sql);
        var context = this.getContext();
        return context.querySync<T[]>(sql);
    }
}

class WhereQuery<T> extends DbQuery<T> {
    constructor(source, predicate) {
        super(source);

        this.predicate = predicate;
    }

    name = "where";

    predicate;
}

class OrderByQuery<T> extends DbQuery<T> {
    constructor(source, keySelector, descending) {
        super(source);

        this.keySelector = keySelector;
        this.descending = descending;
    }

    protected name = "orderBy";

    protected keySelector;

    protected descending;
}

class SelectQuery<T, T2> extends DbQuery<T2> {
    constructor(source, selector: ((item: T) => T2) | string | string[]) {
        super(source);

        this.selector = selector;
    }

    protected  name = "select";

    protected selector: ((item: T) => T2) | string | string[];
}


class FirstQuery<T> extends DbQuery<T> {
    constructor(source, predicate?) {
        super(source);

        this.predicate = predicate;
    }

    protected name = "first";

    protected predicate;
}

class JoinQuery<TResult, TInner, TKey> extends DbQuery<TResult> {
    constructor(source, inner, outerKey, innerKey, resultSelector) {
        super(source);

        this.inner = inner;
        this.outerKey = outerKey;
        this.innerKey = innerKey;
        this.resultSelector = resultSelector;
    }

    protected name = "join";

    protected inner;

    protected  outerKey;

    protected innerKey;

    protected resultSelector;
}

class DbSet<T> extends DbQuery<T> {
    constructor(context, model, name) {
        super(null);
        this.context = context;
        this.model = model;
        this.name = name;
    }

    public context: DbContext;
    protected model: any;

    async add(obj: T) {
        var sql = `INSERT INTO ${this.name} SET ?`;
        console.log(sql);
        var result = await this.query(sql, obj);
        obj.id = result.insertId;
        return obj;
    }

    async update(obj: T) {
        var sql = `UPDATE ${this.name} SET ? WHERE id=${obj.id}`;
        console.log(sql);
        await this.query(sql, obj);
    }

    async remove(obj: T) {
        var sql = null;
        if (typeof obj === "number") {
            sql = `DELETE FROM ${this.name} WHERE id=${obj}`;
        } else if (typeof obj === "object") {
            sql = `DELETE FROM ${this.name} WHERE id=${obj.id}`;
        } else {
            throw "Invalid argument";
        }
        console.log(sql);
        await this.query(sql);
    }

    async find(id) {
        if (typeof id === "string") {
            id = this.context.db.escape(id);
        }
        var sql = `SELECT * FROM ${this.name} WHERE id=${id} LIMIT 1`;
        console.log(sql);
        var result = await this.query(sql);
        var item = result[0];
        return <T>item;
    }

    query(sql: string, arg?: any): Promise<T[]> {
        return this.context.query<T>(sql, arg);
    }

    querySync(sql: string, arg?: any): T[] {
        return this.context.querySync<T>(sql, arg);
    }
}

class DbContext {
    constructor(db) {
        this.db = db;
    }

    protected db;

    query<T>(sql: string, arg?: any): Promise<T[]> {
        return this.db.query(sql, arg);
    }

    querySync<T>(sql: string, arg?: any): T[] {
        return this.db.querySync(sql, arg);
    }
}


interface Post {
    id: number;
    title: string;
    content: string;
    author_id: string;
    published: Date;
}

interface User {
    id: string;
    name: string;
}

class BlogContext extends DbContext {
    constructor(db) {
        super(db);
    }

    posts = new DbSet<Post>(this, "Post", "posts");

    users = new DbSet<User>(this, "User", "users");
}

class Translator {
    static translate(query) {
        if ("context" in query) {
            return "SELECT * FROM " + query.name;
        } else {
            if (query.name === "join") {
                return "SELECT " + Translator.selectProjection(query.resultSelector) + " " + `${Translator.translate2(query.source) } JOIN ${"users"} ON ${Translator.translateLambda(query.outerKey) } = ${Translator.translateLambda(query.innerKey) }`;
            }
            if (query.name !== "select") {
                return "SELECT * " + Translator.translate2(query);
            } else {
                if (query.selector instanceof Function) {
                    return "SELECT " + Translator.selectProjection(query.selector) + " " + `FROM (${Translator.translate(query.source) }) t`;
                }
                return "SELECT " + Translator.selectProjection(query.selector) + " " + Translator.translate2(query.source);
            }
        }
    }

    static translate2(query) {
        if (query.name === "select") {
            return Translator.translate2(query.source) + ` SELECT ${Translator.selectProjection(query.selector) }`;
        } else if (query.name === "orderBy") {
            return Translator.translate2(query.source) + ` ORDER BY ${Translator.translateLambda(query.keySelector) }` + (query.descending ? " DESC" : " ");
        } else if (query.name === "where") {
            return Translator.translate2(query.source) + ` WHERE ${Translator.translateLambda(query.predicate) }`;
        } else if (query.name === "join") {
            return "FROM (SELECT " + Translator.selectProjection(query.resultSelector) + " " + `${Translator.translate2(query.source) } JOIN ${"users"} ON ${Translator.translateLambda(query.outerKey) } = ${Translator.translateLambda(query.innerKey) }) f`;
        } else if (query.name === "first") {
            if (typeof query.predicate !== "undefined") {
                return Translator.translate2(query.source) + ` WHERE ${Translator.translateLambda(query.predicate) } LIMIT 1`;
            }
            return Translator.translate2(query.source) + ` LIMIT 1`;
        } else {
            if ("context" in query) {
                return "FROM " + query.name;
            } else {
                throw "ERROR";
            }
        }
    }

    static selectProjection(arg) {
        if (arg instanceof Array) {
            var str = "";
            var i = 0;
            for (var item of arg) {
                str += item;
                if (i++ < arg.length - 1) {
                    str += ", ";
                }
            }
            return str;
        } else if (arg instanceof String) {
            return arg;
        } else if (arg instanceof Function) {
            return Translator.translateLambda(arg);
        } else {
            throw "Hej";
        }
    }

    static translateLambda(func) {
        if (typeof func === "function") {
            var ast = esprima.parse(func.toString());
            //console.log(func.toString());
            //console.log(JSON.stringify(ast, null, 4));
            var body = ast["body"][0]["expression"]["body"];

            if (body.type === "BlockStatement") {
                if (body.body.length == 1) {
                    var statement = body.body[0];
                    if (statement.type === "ReturnStatement") {
                        var expression = statement.argument;
                        if (expression.type === "ObjectExpression") {
                            var str = "";
                            var i = 0;
                            var props = expression.properties;
                            for (var prop of props) {
                                var expr = Translator.parseExpr(prop.value);
                                str += `${expr} AS ${prop.key.name}`;
                                if (i++ < props.length - 1) {
                                    str += ", ";
                                }
                            }
                            return str;
                        }
                        else {
                            throw "Invalid expression.";
                        }
                    }
                }
                else if (body.body.length > 1) {
                    throw "Only one statement is allowed.";
                }
                else {
                    throw "Expected an expression.";
                }
            } else {
                return Translator.parseExpr(body);
            }
        }
        return func;
    }

    static parseExpr(expr) {
        switch (expr.type) {
            case "UnaryExpression":
                return Translator.parseUnaryExpr(expr);

            case "BinaryExpression":
                return Translator.parseBinaryExpr(expr);

            case "LogicalExpression":
                return Translator.parseLogicalExpr(expr);

            case "MemberExpression":
                return Translator.parseMemberExpr(expr);

            case "CallExpression":
                return Translator.parseCallExpr(expr);

            case "ObjectExpression":
                return Translator.parseObjectExpr(expr);

            case "ParenthesisExpression": // Not existing?
                return `(${expr})`;

            case "Identifier":
                return Translator.parseIdentifier(expr);

            case "Literal":
                return Translator.parseLiteral(expr);
        }

        return "<ERROR>";
    }

    static parseObjectExpr(expr) {
        var op = ""
    }

    static parseUnaryExpr(expr) {
        var op = ""
        switch (expr.operator) {
            case "!":
                op = "NOT";
                break;

            default:
                op = expr.operator;
                break;
        }
        return `${op} ${Translator.parseExpr(expr.argument) }`;
    }

    static parseBinaryExpr(expr) {
        var op = ""
        switch (expr.operator) {
            case "==":
            case "===":
                op = "=";
                break;

            case "!==":
            case "!===":
                op = "<>";
                break;

            default:
                op = expr.operator;
                break;
        }
        return `(${Translator.parseExpr(expr.left) } ${op} ${Translator.parseExpr(expr.right) })`;
    }

    static parseLogicalExpr(expr) {
        var op = ""
        switch (expr.operator) {
            case "&&":
                op = "AND";
                break;

            case "||":
                op = "OR";
                break;

            default:
                op = expr.operator;
                break;
        }
        return `(${Translator.parseExpr(expr.left) } ${op} ${Translator.parseExpr(expr.right) })`;
    }

    static parseMemberExpr(expr) {
        if (typeof expr.object !== "undefined") {
            if (expr.property.name === "length") {
                return `LENGTH(${expr.object.property.name})`;
            }
            return Translator.parseIdentifier(expr.property);
        }
        return Translator.parseIdentifier(expr.property);
    }

    static parseCallExpr(expr) {
        var callee = expr.callee;
        var args = expr.arguments;

        var member = Translator.parseMemberExpr(callee);

        if (member === "startsWith") {
            var x = args[0];
            return `${callee.object.property.name} LIKE "${this.parseExpr(x).replace('"', '').replace('"', '') }%"`;
        } else if (member === "endsWith") {
            var x = args[0];
            return `${callee.object.property.name} LIKE "%${this.parseExpr(x).replace('"', '').replace('"', '') }"`;
        } else if (member === "contains") {
            var x = args[0];
            return `${callee.object.property.name} LIKE "%${this.parseExpr(x).replace('"', '').replace('"', '') }%"`;
        }
        else if (member === "toLowerCase") {
            var x = args[0];
            return `LOWER(${callee.object.property.name})`;
        }
        else if (member === "toUpperCase") {
            var x = args[0];
            return `UPPER(${callee.object.property.name})`;
        }
    }

    static parseIdentifier(expr) {
        return expr.name;
    }

    static parseLiteral(expr) {
        var op = ""
        switch (expr.raw) {
            case "true":
                op = "TRUE";
                break;

            case "false":
                op = "FALSE";
                break;

            default:
                op = expr.raw;
                break;
        }
        return op;
    }
}

(async function () {
    var db = new Database(config);

    var context = new BlogContext(db);

    //var items = await context.posts
    //    .where(x => x.title.contains("ll"))
    //    .orderBy(x => x.title)
    //    .select(x => {
    //        return {
    //            header: x.title,
    //            published: x.published
    //        };
    //    })
    //    .select(x => {
    //        return {
    //            header: x.header.toLowerCase(),
    //            length: x.header.length
    //        };
    //    })
    //    .toArray();

    var items = await context.posts
        .where(x => x.id > 12)
        .join(context.users,
            iItem => iItem.author_id,
            oItem => oItem.id,
            (arg1, arg2) => {
                return {
                    title: arg1.title,
                    author: arg2.name
                };
            })
        .where(x => x.author.contains("ll"))
        .orderBy(x => x.author)
        .toArray();

    for (let item of items) {
        console.log(JSON.stringify(item));
    }

    //console.log(item.getClassName());
    //var ast = esprima.parse("var x = { x: 2, y: 3 }");
    //console.log(JSON.stringify(ast, null, 4));

})();
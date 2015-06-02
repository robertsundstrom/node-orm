declare function require(str: string);

var mysql = require("mysql2");
var esprima = require("esprima");
var config = require("./config");

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

    escape(text) {
        return mysql.escape(text);
    }
}

class DbQuery<T> {
    constructor(source) {
        this.source = source;
        this.type = "";
    }

    type: string;

    source: any;

    where(predicate: ((item: T) => boolean) | string): DbQuery<T> {
        if (predicate instanceof Function) {

        }
        return new WhereQuery<T>(this, predicate);
    }

    orderBy<TKey>(keySelector: ((item: T) => TKey) | string): DbQuery<T> {
        return new OrderByQuery<T>(this, keySelector, false);
    }

    orderByDesc<TKey>(keySelector: ((item: T) => TKey) | string): DbQuery<T> {
        return new OrderByQuery<T>(this, keySelector, true);
    }

    select<T2>(selector: ((item: T) => T2) | string | string[]): DbQuery<T2> {
        return new SelectQuery<T, T2>(this, selector);
    }

    async first(predicate?: ((item: T) => boolean) | string) {
        var query = new FirstQuery(this, predicate);
        var context = this.getContext();
        var sql = new Translator(context).translate(this);
        var result = await context.query<T>(sql);
        return <T><any>result[0];
        //return null;
    }

    join<TInner, TKey, TResult>(
        inner: DbSet<TInner>,
        outerKeySelector: (item: T) => TKey,
        innerKeySelector: (item: TInner) => TKey,
        resultSelector: (arg1: T, arg2: TInner) => TResult): DbQuery<TResult> {
        return new JoinQuery<TResult, TInner, TKey>(this, inner, outerKeySelector, innerKeySelector, resultSelector);
    }

    include<TProperty>(property: (item: T) => TProperty): IncludeQuery<T, TProperty> {
        return null;
    }

    toArray(): Promise<T[]> {
        var context = this.getContext();
        var sql = new Translator(context).translate(this);
        console.log(sql);
        return context.query<T>(sql);
        //return null;
    }

    protected getContext(): DbContext {
        var r = this;
        while (r.source !== null) {
            r = r.source;
        } 
        var f = <any>r;
        return <DbContext>f.context;
    }

    protected getModel(): any {
        var context = this.getContext();
        return (<any>context).model;
    }
}

class WhereQuery<T> extends DbQuery<T> {
    constructor(source, predicate) {
        super(source);

        this.type = "where";

        this.predicate = predicate;
    }

    predicate;
}

class OrderByQuery<T> extends DbQuery<T> {
    constructor(source, keySelector, descending) {
        super(source);

        this.type = "orderby";

        this.keySelector = keySelector;
        this.descending = descending;
    }

    protected keySelector;

    protected descending;
}

class SelectQuery<T, T2> extends DbQuery<T2> {
    constructor(source, selector: ((item: T) => T2) | string | string[]) {
        super(source);

        this.type = "select";

        this.selector = selector;
    }

    protected selector: ((item: T) => T2) | string | string[];
}

class IncludeQuery<T, T2> extends DbQuery<T> {
    constructor(source, selector: ((item: T) => T2) | string | string[]) {
        super(source);

        this.type = "include";

        this.selector = selector;
    }

    protected selector: ((item: T) => T2) | string | string[];
}


class FirstQuery<T> extends DbQuery<T> {
    constructor(source, predicate?) {
        super(source);

        this.type = "first";

        this.predicate = predicate;
    }

    protected predicate;
}

class JoinQuery<TResult, TInner, TKey> extends DbQuery<TResult> {
    constructor(source, inner, outerKey, innerKey, resultSelector) {
        super(source);

        this.type = "join";

        this.inner = inner;
        this.outerKey = outerKey;
        this.innerKey = innerKey;
        this.resultSelector = resultSelector;

        this.name = source.getClassName() + "_" + inner.getClassName();
    }

    public name: string;

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

    public name: string;
    public context: DbContext;

    public model: any;

    async add(obj: T) {
        var sql = `INSERT INTO ${this.name} SET ?`;
        console.log(sql);
        var result = await this.query(sql, obj);
        (<any>obj).id = (<any>result).insertId;
        return obj;
    }

    async update(obj: T) {
        var sql = `UPDATE ${this.name} SET ? WHERE id=${(<any>obj).id}`;
        console.log(sql);
        await this.query(sql, obj);
    }

    async remove(obj: T) {
        var sql = null;
        if (typeof obj === "number") {
            sql = `DELETE FROM ${this.name} WHERE id=${obj}`;
        } else if (typeof obj === "object") {
            sql = `DELETE FROM ${this.name} WHERE id=${(<any>obj).id}`;
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
}

class DbContext {
    constructor(db) {
        this.db = db;
    }

    public db;

    query<T>(sql: string, arg?: any): Promise<T[]> {
        return this.db.query(sql, arg);
    }

    set(entity: string) {
        return this.sets().find(x => x.model === entity)[0];
    }

    sets() {
        var sets = [];
        for (var prop in this) {
            var obj = this[prop];
            if (obj instanceof DbSet) {
                sets.push(obj);
            }
        }
        return sets;
    }
}

interface Post {
    id: number;
    title: string;
    content: string;
    author_id: string;
    published: Date;

    author: User;
}

interface User {
    id: string;
    name: string;

    posts: Post[];
}

class BlogContext extends DbContext {
    constructor(db) {
        super(db);
    }

    posts = new DbSet<Post>(this, "Post", "posts");

    users = new DbSet<User>(this, "User", "users");
}

class QueryContext {
    constructor(context: TranslatorContext, inner: QueryContext, query) {
        this.context = context;
        this.inner = inner;
        this.query = query;
    }

    context: TranslatorContext;
    inner: QueryContext;
    query: any;

    //get type() {
    //    return this.query.
    //}
}

class TranslatorContext {
    sets: any;
    queryContext: QueryContext;

    build(query) {
        if (query.source !== null) {
            this.queryContext = this.build(query.source);
        }
        this.queryContext = new QueryContext(this, this.queryContext, query);
        return this.queryContext;
    }

    registerSet(name: string, type: string) {

    }
}

class Translator {
    context: TranslatorContext;

    constructor(db: DbContext) {
        var context = new TranslatorContext();
        context.sets = db.sets();
        this.context = context;
    }

    translate<T>(query: DbQuery<T>): string {
        this.context.build(query);

        this.resolveQuery(this.context.queryContext);
        this.translateQuery(this.context.queryContext);

        return null;
    }

    resolveQuery(context: QueryContext) {
        var query = context.query;
        var type = query.type;
        if (type === "where") {

        } else if (name === "orderby") {

        } else if (name === "select") {

        } else {
            throw "Foo";
        }
    }

    translateQuery(context: QueryContext) {

    }
}

(async function () {
    var db = new Database(config);

    var context = new BlogContext(db);

    var items = await context.posts
        .where(x => x.id > 12)
        .join(context.users,
            innerItem => innerItem.author_id,
            outerItem => outerItem.id,
            (arg1, arg2) => ({
                    title: arg1.title,
                    author: arg2.name
                }))
        .where(x => x.author.contains("ll"))
        .orderBy(x => x.author)
        .toArray();

    for (let item of items) {
        console.log(JSON.stringify(item));
    }

})();
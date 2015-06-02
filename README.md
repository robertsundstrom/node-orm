# node-orm
ORM for NodeJS

    var db = new Database(config);

    var context = new BlogContext(db);

    var items = await context.posts
        .where(x => x.title.contains("ll"))
        .orderBy(x => x.title)
        .select(x => {
            return {
                header: x.title,
                published: x.published
            };
        })
        .select(x => {
            return {
                header: x.header.toLowerCase(),
                length: x.header.length
            };
        })
        .toArray();

The version found in ../prototype is functional.

Database connection defined in config.js.

Requires:

* TypeScript compiler built from the "asyncFunction" branch.
* TypeScript compiler in ES6 mode for async/await support.
* io.js for ES6 support, with flags: --use_strict --harmony  --harmony_arrow_functions


Built using NodeJS Tools for Visual Studio.

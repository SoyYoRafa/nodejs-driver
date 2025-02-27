/*
 * Copyright DataStax, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const assert = require('assert');
const helper = require('../../../test-helper');
const mapperTestHelper = require('./mapper-test-helper');
const types = require('../../../../lib/types');
const utils = require('../../../../lib/utils');
const Uuid = types.Uuid;
const q = require('../../../../lib/mapping/q').q;
const Mapper = require('../../../../lib/mapping/mapper');
const assertRowMatchesDoc = mapperTestHelper.assertRowMatchesDoc;
const Result = require('../../../../lib/mapping/result');
const vit = helper.vit;

describe('ModelMapper', function () {

  mapperTestHelper.setupOnce(this);

  const mapper = mapperTestHelper.getMapper();
  const client = mapper.client;
  const videoMapper = mapper.forModel('Video');
  const userMapper = mapper.forModel('User');
  const clusteringMapper = mapper.forModel('Clustering');
  const staticMapper = mapper.forModel('Static');
  const static2Mapper = mapper.forModel('Static2');

  describe('#find()', () => {
    it('should use the correct table', () => {
      const doc = { id: mapperTestHelper.videoIds[0] };
      return videoMapper.find(doc, null, 'default').then(result => {
        assert.ok(result.first());
      });
    });

    it('should use the correct table when no MappingOptions are specified', () => {
      const mapper = new Mapper(client);
      const modelMapper = mapper.forModel('videos');
      const doc = { videoid: mapperTestHelper.videoIds[0] };
      return modelMapper.find(doc)
        .then(result => assert.ok(result.first()));
    });

    it('should use the another table', () => {
      const doc = { userId: mapperTestHelper.userIds[0] };
      return videoMapper.find(doc, { fields: ['id', 'userId', 'name'] }, 'default').then(result => {
        assert.ok(result.first());
      });
    });

    it('should use the provided fields and order by when defined', () => {
      const doc = { yyyymmdd: 'NOTEXISTENT' };
      return videoMapper.find(doc, { fields: ['id', 'yyyymmdd', 'name'], orderBy: { 'addedDate': 'asc'} }, 'default')
        .then(result => {
          assert.strictEqual(result.first(), null);
        });
    });

    it('should use select the correct table based on order by columns', () => {
      const doc = { id1: 'a' };

      const items = [
        { orderBy: { id2: 'asc', id3: 'asc' }, table: 1 },
        { orderBy: { id2: 'desc' }, table: 1 },
        { orderBy: { id2: 'asc' }, table: 1 },
        { orderBy: { id3: 'asc', id2: 'asc' }, table: 2 },
        { orderBy: { id3: 'desc' }, table: 2 },
        { orderBy: { id3: 'asc' }, table: 2 },
      ];

      return Promise.all(items.map(item =>
        clusteringMapper.find(doc, { orderBy: item.orderBy }, 'default')
          .then(result => {
            const expectedValues = utils.objectValues(item.orderBy)[0] === 'asc'
              ? [ `value_abc_table${item.table}`, `value_azz_table${item.table}` ]
              : [ `value_azz_table${item.table}`, `value_abc_table${item.table}` ];
            assert.deepStrictEqual(result.toArray().map(x => x.value), expectedValues);
          }))
      );
    });

    it('should support manual paging', () => {
      const userId = Uuid.random();
      const videoIds = [ Uuid.random(), Uuid.random(), Uuid.random(), Uuid.random(), Uuid.random() ];
      const videosResult = [];
      let pageState;
      return Promise
        .all(videoIds.map((id, i) =>
          mapperTestHelper.insertVideoRows(client, { id, userId, addedDate: new Date(), name: `video${i}` })))
        .then(() => videoMapper.find({ userId }, null, { fetchSize: 3 }))
        .then(result => {
          assert.strictEqual(result.length, 3);
          assert.ok(result.pageState);
          pageState = result.pageState;
          videosResult.push.apply(videosResult, result.toArray());
        })
        .then(() => videoMapper.find({ userId }, null, { fetchSize: 3, pageState }))
        .then(result => {
          assert.strictEqual(result.length, 2);
          videosResult.push.apply(videosResult, result.toArray());
          videosResult.map(v => v.name).sort().forEach((name, i) => assert.strictEqual(name, `video${i}`));
          videosResult.forEach(v => assert.ok(
            videoIds.reduce((acc, id) => acc + (v.id.toString() === id.toString() ? 1 : 0), 0) === 1));
        });
    });

    it('should throw an error when the table does not exist', () => testTableNotFound(mapper, 'find'));

    vit('3.0', 'should support query operators', () => {
      const testItems = [
        { op: q.in_, value: [new Date('2012-06-01 06:00:00Z')], expected: 1 },
        { op: q.gt, value: new Date('2012-06-01 05:00:00Z'), expected: 1 },
        { op: q.gt, value: new Date('2012-06-01 06:00:00Z'), expected: 0 },
        { op: q.gt, value: new Date('2012-06-01 07:00:00Z'), expected: 0 },
        { op: q.gte, value: new Date('2012-06-01 05:00:00Z'), expected: 1 },
        { op: q.gte, value: new Date('2012-06-01 06:00:00Z'), expected: 1 },
        { op: q.gte, value: new Date('2012-06-01 07:00:00Z'), expected: 0 },
        { op: q.lt, value: new Date('2012-06-01 05:00:00Z'), expected: 0 },
        { op: q.lt, value: new Date('2012-06-01 06:00:00Z'), expected: 0 },
        { op: q.lt, value: new Date('2012-06-01 07:00:00Z'), expected: 1 },
        { op: q.lte, value: new Date('2012-06-01 05:00:00Z'), expected: 0 },
        { op: q.lte, value: new Date('2012-06-01 06:00:00Z'), expected: 1 },
        { op: q.lte, value: new Date('2012-06-01 07:00:00Z'), expected: 1 }
      ];

      return Promise.all(testItems.map((item, index) => {
        const doc = { yyyymmdd: mapperTestHelper.yyyymmddBuckets[0], addedDate: item.op(item.value) };
        return videoMapper.find(doc, 'default')
          .then(result => {
            assert.strictEqual(result.toArray().length, item.expected,
              `Failed for g.${item.op.name}(), item at index ${index}: expected ${item.expected}; ` +
              `obtained ${result.toArray().length}`);
          });
      }));
    });
  });

  describe('#findAll()', () => {
    it('should query without filter', () => videoMapper.findAll()
      .then(result => {
        helper.assertInstanceOf(result, Result);
        assert.ok(result.length > 0);
        assert.strictEqual(typeof result.first().name, 'string');
      }));

    it('should use the correct table when no MappingOptions are specified', () => {
      const mapper = new Mapper(client);
      const modelMapper = mapper.forModel('videos');
      return modelMapper.findAll().then(result => assert.ok(result.length > 0));
    });

    it('should support fields and limit', () => videoMapper.findAll({ fields: [ 'id', 'addedDate' ], limit: 1 })
      .then(result => {
        helper.assertInstanceOf(result, Result);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result.first().name, undefined);
        assert.notStrictEqual(result.first().addedDate, undefined);
      }));
  });

  describe('#get()', () => {
    it('should return the first match on a table with a single partition key', () => {
      const doc = { id: mapperTestHelper.videoIds[0] };
      return videoMapper.get(doc).then(resultDoc => {
        assert.ok(resultDoc);
        assert.strictEqual(resultDoc.constructor, Object);
        assert.strictEqual(resultDoc.id.toString(), doc.id.toString());
      });
    });

    it('should return the first match on a table with composite primary key', () => {
      const doc = {
        id: mapperTestHelper.videoIds[0],
        userId: mapperTestHelper.userIds[0],
        addedDate: mapperTestHelper.addedDates[0]
      };

      return videoMapper.get(doc).then(resultDoc => {
        assert.ok(resultDoc);
        assert.strictEqual(resultDoc.userId.toString(), doc.userId.toString());
        // "preview_image_location" is only defined on the user_videos table
        assert.ok(resultDoc.preview);
      });
    });

    it('should return null when not found', () =>
      videoMapper.get({id: Uuid.random()}).then(resultDoc => assert.strictEqual(resultDoc, null)));

    it('should throw an error when the table does not exist', () => testTableNotFound(mapper, 'get'));

    it('should throw an error when the filter is empty', () => {
      let catchCalled = false;

      return videoMapper.get({})
        .catch(err => {
          catchCalled = true;
          helper.assertInstanceOf(err, Error);
          assert.strictEqual(err.message, 'Expected object with keys');
        })
        .then(() => assert.strictEqual(catchCalled, true));
    });
  });

  describe('#insert()', () => {
    it('should insert on all tables where the partition and clustering keys are specified', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'Video insert sample 1',
        description: 'description insert 1', yyyymmdd: new Date().toISOString().substr(0, 10), tags: ['a', 'b'],
        location: 'a/b/c', locationType: 1, preview: 'a/preview/c', thumbnails: { 'p1': 'd/e/f' }
      };

      return videoMapper.insert(doc, null, 'default')
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          // It should have been inserted on the 3 tables
          assert.strictEqual(rows.length, 3);
          rows.forEach(row => assertRowMatchesDoc(row, doc));
        });
    });

    it('should use the correct table when no MappingOptions are specified', () => {
      const mapper = new Mapper(client);
      const modelMapper = mapper.forModel('videos');
      const doc = { videoid: Uuid.random(), name: 'ABC' };
      return modelMapper.insert(doc)
        .then(() => mapperTestHelper.getVideoRows(client, { id: doc.videoid }))
        .then(rows => {
          // Inserted on "videos" table
          assert.strictEqual(rows.length, 1);
          assert.strictEqual(rows[0]['name'], doc.name);
        });
    });

    it('should insert on some of the tables when those keys are not specified', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'Video insert 2 not in latest',
        description: 'This video will not be added to latest_videos table',
      };

      return videoMapper.insert(doc, null, 'default')
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          // Inserted on "videos" and "user_videos" tables
          assert.strictEqual(rows.length, 2);
          rows.forEach(row => assertRowMatchesDoc(row, doc));
        });
    });

    it('should insert a single table when it only matches one table', () => {
      const doc = { id: Uuid.random(), name: 'Video insert 3' };

      return videoMapper.insert(doc, null, 'default')
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          // Inserted only on "videos" table
          assert.strictEqual(rows.length, 1);
          rows.forEach(row => assertRowMatchesDoc(row, doc));
        });
    });

    it('should consider fields filter', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'Video insert sample 4',
        description: 'description insert 4', yyyymmdd: new Date().toISOString().substr(0, 10), locationType: 1,
        preview: 'a/preview/c'
      };

      return videoMapper.insert(doc, { fields: ['id', 'userId', 'addedDate', 'name']}, 'default')
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          // Inserted on "videos" and "user_videos" tables
          assert.strictEqual(rows.length, 3);
          // It retrieved a empty ResultSet
          assert.strictEqual(rows[2], null);

          // Use a doc with undefined values for fields not included
          const expectedDoc = { id: doc.id, userId: doc.userId, addedDate: doc.addedDate, name: doc.name };

          rows.slice(0, 2).forEach(row => assertRowMatchesDoc(row, expectedDoc));
        });
    });

    it('should support conditional statements on a single table', () => {
      // Description column is only present on a table
      const doc = { id: Uuid.random(), name: 'Conditional inserted', description: 'description inserted' };

      return videoMapper.insert(doc, { ifNotExists: true })
        .then(() => mapperTestHelper.getVideoRows(client, doc, 'videoid, name, description'))
        .then(rows => {
          assertRowMatchesDoc(rows[0], doc);
        });
    });

    it('should fail when conditional statements affect multiple tables', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'Video insert conditional',
        description: 'description insert 5', yyyymmdd: new Date().toISOString().substr(0, 10), locationType: 1,
        preview: 'a/preview/c'
      };

      let error;

      return videoMapper.insert(doc, { ifNotExists: true }, 'default')
        .catch(err => error = err)
        .then(() => {
          helper.assertInstanceOf(error, Error);
          assert.strictEqual(error.message, 'Batch with ifNotExists conditions cannot span multiple tables');
        });
    });

    it('should throw an error when the table does not exist', () => testTableNotFound(mapper, 'find'));

    it('should support inserting static column value without clustering keys', () => {

      const doc = { id1: Uuid.random().toString(), s: 'static value 1' };

      return staticMapper.insert(doc)
        .then(() => client.execute('SELECT id1, s FROM table_static1 WHERE id1 = ?', [ doc.id1 ], { prepare: true }))
        .then(rs => assertRowMatchesDoc(rs.first(), doc));
    });

    it('should support inserting static column value with clustering keys', () => {

      const doc = { id1: Uuid.random().toString(), id2: 'b', s: 'static value 2' };

      return staticMapper.insert(doc)
        .then(() =>
          client.execute('SELECT id1, id2, s FROM table_static1 WHERE id1 = ?', [ doc.id1 ], { prepare: true }))
        .then(rs => assertRowMatchesDoc(rs.first(), doc));
    });

    it('should support inserting multiple static column values without clustering keys', () => {

      const doc = { id1: Uuid.random().toString(), s0: 'static value 1', s1: 'static value 2' };

      return static2Mapper.insert(doc)
        .then(() => client.execute('SELECT id1, s0, s1 FROM table_static2 WHERE id1 = ?', [ doc.id1 ], { prepare: true }))
        .then(rs => assertRowMatchesDoc(rs.first(), doc));
    });

  });

  describe('#update()', () => {
    it('should update on all tables where the partition and clustering keys are specified', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'video all 1',
        description: 'description 1', yyyymmdd: new Date().toISOString().substr(0, 10) };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => doc.name = 'updated all 1')
        .then(() => videoMapper.update(doc))
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => rows.forEach(row => assertRowMatchesDoc(row, doc)));
    });

    it('should update a single table when it only matches one table', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'video single 1',
        description: 'description 1', yyyymmdd: new Date().toISOString().substr(0, 10) };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => videoMapper.update({ id: doc.id, name: 'updated single 1'}))
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          assert.strictEqual(rows.length, 3);
          // Only the first table was updated
          assert.strictEqual(rows[0]['name'], 'updated single 1');
          assert.strictEqual(rows[1]['name'], doc.name);
          assert.strictEqual(rows[2]['name'], doc.name);
        });
    });

    it('should support updating static column value without clustering keys', () => {

      const doc = { id1: Uuid.random().toString(), s: 'static value 1' };

      return staticMapper.update(doc)
        .then(() => client.execute('SELECT id1, s FROM table_static1 WHERE id1 = ?', [ doc.id1 ], { prepare: true }))
        .then(rs => assertRowMatchesDoc(rs.first(), doc));
    });

    it('should use the correct table when no MappingOptions are specified', () => {
      const mapper = new Mapper(client);
      const modelMapper = mapper.forModel('videos');
      const doc = { videoid: Uuid.random(), name: 'ABC Update' };
      return modelMapper.update(doc)
        .then(() => mapperTestHelper.getVideoRows(client, { id: doc.videoid }))
        .then(rows => {
          // Inserted on "videos" table
          assert.strictEqual(rows.length, 1);
          assert.strictEqual(rows[0]['name'], doc.name);
        });
    });

    it('should consider fields filter', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'filter test', description: 'my desc'
      };

      return videoMapper.update(doc, { fields: [ 'id', 'userId', 'addedDate', 'name' ] })
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          assert.strictEqual(rows.length, 2);
          rows.forEach(row => {
            assert.ok(row);
            assert.strictEqual(row['videoid'].toString(), doc.id.toString());
            assert.strictEqual(row['name'], doc.name);
          });

          // Description was not included in the fields
          assert.strictEqual(rows[0]['description'], null);
        });
    });

    it('should support conditional statements on a single table', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'video cond 1',
        description: 'description 1', yyyymmdd: new Date().toISOString().substr(0, 10) };

      const docUpdated = { id: doc.id, description: 'description updated' };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => videoMapper.update(docUpdated, { when: { name: 'video cond 1'}}))
        .then(result => {
          helper.assertInstanceOf(result, Result);
          assert.strictEqual(result.wasApplied(), true);
          assert.strictEqual(result.length, 0);
        })
        .then(() => mapperTestHelper.getVideoRows(client, docUpdated, 'videoid, description'))
        .then(rows => {
          assertRowMatchesDoc(rows[0], docUpdated);
        });
    });

    it('should fail when conditional statements affect multiple tables', () => {
      const doc = { id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'video cond 2' };
      const docUpdated = { id: doc.id, userId: doc.userId, addedDate: doc.addedDate, name: 'name updated' };

      let error;

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => videoMapper.update(docUpdated, { when: { name: 'video cond 2'}}))
        .catch(err => error = err)
        .then(() => {
          helper.assertInstanceOf(error, Error);
          assert.strictEqual(error.message, 'Batch with when or ifExists conditions cannot span multiple tables');
        });
    });

    it('should adapt results of a LWT operation', () => {
      function assertNotApplied(result) {
        helper.assertInstanceOf(result, Result);
        assert.strictEqual(result.wasApplied(), false);
        assert.strictEqual(result.length, 1);
      }

      const doc = { id: Uuid.random(), firstName: 'hey', lastName: 'joe', email: 'hey@example.com' };

      const insertQuery = 'INSERT INTO users (userid, firstname, lastname, email) VALUES (?, ?, ?, ?)';

      return client.execute(insertQuery, [ doc.id, doc.firstName, doc.lastName, doc.email ], { prepare: true })
        .then(() => userMapper.update(doc, { when: { firstName: 'a' }}))
        .then(result => {
          assertNotApplied(result);
          const lwtDoc = result.first();
          assert.strictEqual(lwtDoc.firstName, doc.firstName);
        })
        .then(() => userMapper.update(doc, { when: { firstName: 'a', lastName: 'b' }}))
        .then(result => {
          assertNotApplied(result);
          const lwtDoc = result.first();
          assert.strictEqual(lwtDoc.firstName, doc.firstName);
          assert.strictEqual(lwtDoc.lastName, doc.lastName);
        })
        .then(() => userMapper.update(doc, { when: { firstName: 'a', lastName: q.notEq(doc.lastName) }}))
        .then(result => {
          assertNotApplied(result);
          const lwtDoc = result.first();
          assert.strictEqual(lwtDoc.firstName, doc.firstName);
          assert.strictEqual(lwtDoc.lastName, doc.lastName);
        });
    });

    it('should add new items to a set', () => {
      const doc = { id: Uuid.random(), name: 'hello', tags: ['a', 'b', 'c']};
      return client
        .execute('INSERT INTO videos (videoid, name, tags) VALUES (?, ?, ?)', [ doc.id, doc.name, doc.tags ],
          { prepare: true })
        .then(() => videoMapper.update({ id: doc.id, tags: q.append(['d', 'e']) }))
        .then(() => mapperTestHelper.getVideoRows(client, { id: doc.id }))
        .then(rows => {
          assert.strictEqual(rows.length, 1);
          assert.deepStrictEqual(rows[0]['tags'], doc.tags.concat('d', 'e'));
        });
    });

    it('should throw an error when the table does not exist', () => testTableNotFound(mapper, 'find'));
  });

  describe('#remove()', () => {
    it('should delete on all tables where the partition and clustering keys are specified', () => {
      const doc = { id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'to delete 1' };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        // Inserted on 2 tables
        .then(rows => assert.strictEqual(rows.length, 2))
        .then(() => videoMapper.remove(doc))
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          assert.strictEqual(rows.length, 2);
          // Deleted on the 2 tables
          assert.deepStrictEqual(rows, [ null, null ]);
        });
    });

    it('should delete on some of the tables when those keys are not specified', () => {
      const doc = { id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'to delete 1' };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        // Inserted on 2 tables
        .then(rows => assert.strictEqual(rows.length, 2))
        // Just provide the primary keys of 1 table
        .then(() => videoMapper.remove({ id: doc.id }))
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          assert.strictEqual(rows.length, 2);
          // Deleted on the 1 of the tables
          assert.strictEqual(rows[0], null);
          mapperTestHelper.assertRowMatchesDoc(rows[1], doc);
        });
    });

    it('should consider fields filter when deleteOnlyColumns is specified', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'to delete 3', description: 'desc 3'
      };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => videoMapper
          .remove(doc, { fields: [ 'id', 'userId', 'addedDate', 'name' ], deleteOnlyColumns: true }))
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          assert.strictEqual(rows.length, 2);
          // Deleted only the cell on both tables
          rows.forEach(row => {
            assert.ok(row);
            assert.strictEqual(row['videoid'].toString(), doc.id.toString());
            assert.strictEqual(row['name'], null);
          });

          assert.strictEqual(rows[0]['description'], doc.description);
        });
    });

    it('should use the correct table when no MappingOptions are specified', () => {
      const mapper = new Mapper(client);
      const modelMapper = mapper.forModel('videos');

      const doc = {
        id: Uuid.random(), name: 'to delete w/ no mapping', description: 'desc 4'
      };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => modelMapper
          .remove({ videoid: doc.id }))
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          assert.strictEqual(rows.length, 1);
          assert.strictEqual(rows[0], null);
        });
    });

    it('should support conditional statements on a single table', () => {
      const doc = { id: Uuid.random(), userId: Uuid.random(), name: 'video to delete' };

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        // It was inserted on 1 table
        .then(rows => {
          assert.strictEqual(rows.length, 1);
          assert.notEqual(rows[0], null);
        })
        .then(() => videoMapper.remove(doc, { when: { name: 'video to delete' }, fields: ['id']}))
        .then(() => mapperTestHelper.getVideoRows(client, doc))
        .then(rows => {
          assert.strictEqual(rows.length, 1);
          assert.strictEqual(rows[0], null);
        });
    });

    it('should fail when conditional statements affect multiple tables', () => {
      const doc = {
        id: Uuid.random(), userId: Uuid.random(), addedDate: new Date(), name: 'video to delete',
        description: 'desc', yyyymmdd: new Date().toISOString().substr(0, 10) };

      let error;

      return mapperTestHelper.insertVideoRows(client, doc)
        .then(() => videoMapper.remove(doc, { when: { name: 'video to delete'}}))
        .catch(err => error = err)
        .then(() => {
          helper.assertInstanceOf(error, Error);
          assert.strictEqual(error.message, 'Batch with when or ifExists conditions cannot span multiple tables');
        });
    });

    it('should throw an error when the table does not exist', () => testTableNotFound(mapper, 'find'));
  });
});

function testTableNotFound(mapper, methodName) {
  const modelMapper = mapper.forModel('TableDoesNotExist');
  let catchCalled = false;

  return modelMapper[methodName]({id: 1})
    .catch(err => {
      catchCalled = true;
      helper.assertInstanceOf(err, Error);
      assert.strictEqual(err.message, 'Table "TableDoesNotExist" could not be retrieved');
    })
    .then(() => assert.strictEqual(catchCalled, true));
}

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VP = root.VP || {};
  root.VP.ITEMS = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  var SHAPES = [
    { id: 'sq', name: 'Cube', price: 0 },
    { id: 'ci', name: 'Orb', price: 150 },
    { id: 'tr', name: 'Dart', price: 200 },
    { id: 'hx', name: 'Hex', price: 260 },
    { id: 'dm', name: 'Gem', price: 340 },
    { id: 'st', name: 'Star', price: 500 }
  ];
  var TRAILS = [
    { id: 't0', name: 'Clean', price: 0 },
    { id: 't1', name: 'Sparks', price: 150 },
    { id: 't2', name: 'Comet', price: 300 },
    { id: 't4', name: 'Bubbles', price: 380 },
    { id: 't3', name: 'Rainbow', price: 550 }
  ];

  function find(kind, id) {
    var list = kind === 'trail' ? TRAILS : SHAPES;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function validPurchase(kind, id) {
    var it = find(kind, id);
    return !!it && it.price > 0;
  }

  return { SHAPES: SHAPES, TRAILS: TRAILS, find: find, validPurchase: validPurchase };
});

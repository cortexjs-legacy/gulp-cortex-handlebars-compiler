'use strict';

module.exports = compiler;

var PluginError = require('gulp-util').PluginError;
var fs = require('fs');
var through = require('through2');
var node_path = require('path');
var compiler = require('cortex-handlebars-compiler');
var cortex_json = require('read-cortex-json');
var events = require('events').EventEmitter;
var util = require('util');
var async = require('async');
var jf = require('jsonfile');
var ngraph = require('neuron-graph');
var semver = require('semver-extra');

function compiler (options){
  return new Compiler(options || {});
};

function Compiler (options) {
  this.cwd = options.cwd || process.cwd();
  this.href_root = options.href_root || '';
  this.jsons = {};
}

util.inherits(Compiler, events);

Compiler.prototype.compile = function() {
  var self = this;
  return through.obj(function (file, enc, callback) {
    if(file.isStream()){
      this.emit('error', new PluginError('gulp-cortex-handlebars-compiler', 'Streaming not supported'));
      return callback();
    }

    self._render(file.path, String(file.contents), function (err, rendered) {
      if (err) {
        this.emit('error', err);
        return callback();
      }

      file.contents = new Buffer(rendered);
      this.push(file);
      callback();

    }.bind(this));
  });
};


Compiler.prototype._render = function(path, template, callback) {
  this._gather_info(function (err, pkg, graph, shrinkwrap) {
    if (err) {
      return callback(err);
    }

    this._improve_graph(graph, pkg);

    var compiled;
    try {
      compiled = compiler({
        pkg: pkg,
        graph: graph,
        cwd: this.cwd,
        shrinkwrap: shrinkwrap,
        path: path,
        href_root: this.href_root
      }).compile(template);
      
    } catch(e) {
      return callback(e);
    }

    var rendered = compiled();
    callback(null, rendered);

  }.bind(this));
};


Compiler.prototype._gather_info = function(callback) {
  function cb (pkg, graph, shrinkwrap) {
    var version = process.env.NEURON_VERSION;
    if (!shrinkwrap.engines && version) {
      shrinkwrap.engines = {
        'neuron': {
          'from': 'neuron@' + version,
          'version': version
        }
      };
    }
    callback(null, pkg, graph, shrinkwrap);
  }

  if (this.pkg && this.graph && this.shrinkwrap) {
    return cb(this.pkg, this.graph, this.shrinkwrap);
  }

  var self = this;
  this._read_pkg(function (err, pkg) {
    if (err) {
      return callback(err);
    }

    var pr = process.env.CORTEX_BUILD_PRERELEASE;
    if (pr) {
      var s = semver.parse(pkg.version);
      s.prerelease.length = 0;
      s.prerelease.push(pr);
      pkg.version = s.format();
    }

    self._read_graph(pkg, function (err, graph, shrinkwrap) {
      if (err) {
        return callback(err);
      }

      self.pkg = pkg;
      self.graph = graph;
      self.shrinkwrap = shrinkwrap;
      cb(self.pkg, graph, shrinkwrap);
    });
  });
};


Compiler.prototype._read_pkg = function (callback) {
  this._read_json(this.cwd, function (path, done) {
    cortex_json.read(path, done);
  }, callback);
};


Compiler.prototype._read_graph = function(pkg, callback) {
  ngraph(pkg, {
    cwd: this.cwd,
    built_root: node_path.join(this.cwd, 'neurons'),
    dependencyKeys: ['dependencies', 'asyncDependencies']
  }, callback);
};


Compiler.prototype._improve_graph = function(graph, pkg) {
  var _ = graph._;
  _[pkg.name + '@*'] = _[pkg.name + '@' + pkg.version];
};


// Queue the read process
Compiler.prototype._read_json = function (path, handler, callback) {
  var json = this.jsons[path];
  if (json) {
    return callback(null, json);
  }

  var event = 'json:' + path;
  var count = events.listenerCount(this, event);
  this.once(event, callback);
  
  var self = this;
  if (count === 0) {
    handler(path, function (err, json) {
      if (!err) {
        self.jsons[path] = json;
      }
      self.emit(event, err, json);
    });
  }
};

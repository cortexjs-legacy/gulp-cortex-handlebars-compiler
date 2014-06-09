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


function compiler (options){
  return new Compiler(options || {});
};

function Compiler (options) {
  this.cwd = options.cwd || process.cwd();
  this.js_ext = options.js_ext || '.js';
  this.css_ext = options.css_ext || '.css';
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
  this._gather_info(function (err, pkg, shrinkWrap) {
    if (err) {
      return callback(err);
    }

    var compiled;
    try {
      compiled = compiler({
        pkg: pkg,
        shrinkWrap: shrinkWrap,
        cwd: this.cwd,
        path: path,
        js_ext: this.js_ext,
        css_ext: this.css_ext,
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
  var pkg;
  var shrinkWrap;
  var self = this; 

  async.parallel([
    function (done) {
      self._read_pkg(function (err, json) {
        pkg = json;
        done(err);
      });
    },

    function (done) {
      self._read_shrinkwrap(function (err, json) {
        shrinkWrap = json;
        done(err);
      });
    }

  ], function (err) {
    if (err) {
      return callback(err);
    }

    callback(null, pkg, shrinkWrap);
  });
};


Compiler.prototype._read_pkg = function (callback) {
  this._read_json(this.cwd, function (path, done) {
    cortex_json.read(path, done);
  }, callback);
};


Compiler.prototype._read_shrinkwrap = function(callback) {
  var shrinkwrap_json = node_path.join(this.cwd, 'cortex-shrinkwrap.json');

  this._read_json(shrinkwrap_json, function (path, done) {
    jf.readFile(path, done);
  }, callback);
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

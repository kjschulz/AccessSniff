/*
 * AccessSniff
 * https://yargalot@github.com/yargalot/AccessSniff
 *
 * Copyright (c) 2015 Steven John Miller
 * Licensed under the MIT license.
 */

var path      = require('path');
var fs        = require('fs');
var _         = require('underscore');
var chalk     = require('chalk');
var Promise   = require('bluebird');
var asset     = path.join.bind(null, __dirname, '..');

var childProcess  = require('child_process')
var phantomPath   = require('phantomjs').path

var _that;

function Accessibility() {

  this.options  = Accessibility.Defaults;
  this.basepath = process.cwd();
  this.failTask = false;

  this.log      = '';
  this.logJSON  = {};
  this.fileContents = '';

  if (this.options.accessibilityrc) {
    this.options.ignore = this.grunt.file.readJSON('.accessibilityrc').ignore;
  }

  _that = this;

}

Accessibility.Defaults = {
  phantomScript: asset('../phantomjs/bridge.js'),
  urls: [],
  domElement: true,
  verbose: true,
  outputFormat: false,
  force: false,
  ignore: [],
  accessibilityrc: false
};


/**
* The Message Terminal, choo choo
*
*
*/

Accessibility.prototype.terminalLog = function(msg, trace) {

  var ignore   = false;
  var msgSplit = msg.split('|');

  var grunt   = _that.grunt;
  var options = _that.options;

  // If ignore get the hell out
  _.each(options.ignore, function (value, key) {
    if (value === msgSplit[1]) {
      ignore = true;
    }
  });

  if (ignore) {
    return;
  }

  // Start the Logging
  if (msgSplit[0] === 'ERROR' || msgSplit[0] === 'NOTICE' || msgSplit[0] === 'WARNING') {

    switch (options.outputFormat) {

      case 'json':
        var jsonLog = _that.logJSON[options.file];

        jsonLog = jsonLog || [];
        jsonLog = jsonLog.concat(_that.outputJson(msgSplit));

        _that.logJSON[options.file] = jsonLog;

      break;

      case 'txt':
        if (!options.domElement) {
          msg = msgSplit.slice(0, 3).join('|');
        }

        _that.log += msg + '\r\n';

      break;
    }

    _that.logger(msgSplit);

  } else {

    _that.logger(msg);

  }
};



/**
* Console logger
*
*
*/

Accessibility.prototype.logger = function(msgSplit) {

  var options       = _that.options;
  var errorMessage  = _.isArray(msgSplit);

  // If options verbose if false gtfo
  if (!options.verbose) {
    return;
  }

  // If its not an error message, return out of it
  if (!errorMessage) {
    return;
  }

  // Start logger
  var heading;
  var position = _that.getElementPosition(msgSplit[3]);

  switch (msgSplit[0]) {
    case 'ERROR':
        heading = chalk.red.bold(msgSplit[0]);
        _that.failTask = true;
    break;
    case 'NOTICE':
        heading = chalk.blue.bold(msgSplit[0]);
    break;
    default:
        heading = chalk.yellow.bold(msgSplit[0]);
    break;
  }

  heading += ' ' + msgSplit[1];

  console.log(heading);
  console.log('Line '.cyan + position.lineNumber + ' col '.cyan  + position.columnNumber);
  console.log(chalk.grey(msgSplit[2]));
  console.log('--------------------');
  console.log(chalk.grey(msgSplit[3]));

  return;

};



/**
* Get Elements Line and Column Number
*
*
*/

Accessibility.prototype.getElementPosition = function(htmlString) {

  var position = {};
  var htmlArray = this.fileContents.split("\n");

  htmlArray.every(function(element, lineNumber) {
    if ( !element.match(htmlString) ) {
      return true;
    }

    var columnNumber = 0;
    var colIndex = 0;

    var pattern = /(\s|\t)/g;

    while (element.charAt(colIndex).match(pattern)) {
      columnNumber++;
      colIndex++;
    }

    position.lineNumber = lineNumber;
    position.columnNumber = columnNumber;

    return false;

  });

  return position;

};



/**
* Json file format
*
*
*/

Accessibility.prototype.outputJson = function(msgSplit) {

  var options     = _that.options;
  var currentLog  = [];

  currentLog.push({
    type: msgSplit[0],
    msg: msgSplit[2],
    sc: msgSplit[1].split('.')[3],
    technique: msgSplit[1].split('.')[4]
  });

  if (options.domElement) {
    currentLog[currentLog.length - 1].element = {
      nodeName: msgSplit[3],
      className: msgSplit[4],
      id: msgSplit[5]
    };
  }

  return currentLog;

};


/**
* Write the file
*
*
*/

Accessibility.prototype.writeFile = function(msg, trace) {

  var grunt   = _that.grunt;
  var options = _that.options;


  // Write messages to console
  function logFinishedMesage() {
    grunt.log.subhead('Report Finished'.cyan);
    grunt.log.writeln('File "' + options.filedest +
      (options.outputFormat ? '.' + options.outputFormat : '') + '" created.');
  }

  // Write the files
  switch (options.outputFormat) {
    case 'json':
      grunt.file.write(options.filedest + '.json', JSON.stringify(_that.logJSON[options.file]));
      logFinishedMesage();
    break;

    case 'txt':
      grunt.file.write(options.filedest + '.txt' , _that.log);
      logFinishedMesage();
    break;
  }

  // Reset the values for next run
  _that.log = '';
  _that.logJSON = {};

  if (_that.failTask && !options.force) {
    _that.grunt.fail.warn('Task ' + _that.grunt.task.current.nameArgs +  ' failed');
  }

  _that.phantom.halt();

};



/**
* Phantom General Errors
*
*
*/

Accessibility.prototype.failLoad = function(url) {
  _that.grunt.fail.fatal('PhantomJS unable to load URL:' + url);
  _that.phantom.halt();
};

Accessibility.prototype.failTime = function() {
  _that.grunt.warn('PhantomJS timed out.');
  _that.phantom.halt();
};

Accessibility.prototype.failError = function(message, trace) {
  _that.grunt.log.error(chalk.red('error: ' + message));
  _that.phantom.halt();
};


Accessibility.prototype.parseOutput = function(file, deferred) {

  var test = file.split("\n");
  var _this = this;

  test.every(function(element, index, array) {

    var something = JSON.parse(element);


    if (something[0] == 'wcaglint.done') {
      return false;
    }

    _this.terminalLog(something[1]);
    return true;

  })


  deferred.fulfill();
};


/**
* Run task
*
* @param {Object} grunt - grunt object
*
* @returns {Object} a promise that resolves with final html
*
*/

Accessibility.prototype.run = function(files) {

  var files   = Promise.resolve(files);
  var _this = this;

  // Built-in error handlers.
  // phantom.on('fail.load',     this.failLoad);
  // phantom.on('fail.timeout',  this.failTime);
  //
  // // The main events
  // phantom.on('error',         this.failError);
  // phantom.on('console',       this.terminalLog);
  // phantom.on('wcaglint.done', this.writeFile);

  var promiseMapOptions = {
    concurrency: 1
  };

  return files
    .bind(this)
    .map(function(file) {

      var deferredOutside = Promise.pending();
      var childArgs = [
        path.join(__dirname, './phantom.js'),
        file,
        {}
      ];

      console.log(chalk.white.underline('Testing ' + childArgs[1]));

      childProcess.execFile(phantomPath, childArgs, function(err, stdout, stderr) {
        // handle results

        if (!err) {

          _this.parseOutput(stdout, deferredOutside);

          return;
        }

        console.log(err);
        console.log(stderr);
        deferredOutside.fulfill();
      });


      fs.readFile(file, 'utf8', function (err, data) {
        _this.fileContents = data.toString();
      });

      return deferredOutside.promise;

    }, promiseMapOptions)
    .catch(function(err) {

      console.error(err);

    })
    .finally();

};

Accessibility.start = function(files, options) {

  var task = new Accessibility();

  task.run(files);

};


module.exports = Accessibility;

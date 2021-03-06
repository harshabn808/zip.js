/*
 Copyright (c) 2012 Gildas Lormeau. All rights reserved.

 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:

 1. Redistributions of source code must retain the above copyright notice,
 this list of conditions and the following disclaimer.

 2. Redistributions in binary form must reproduce the above copyright 
 notice, this list of conditions and the following disclaimer in 
 the documentation and/or other materials provided with the distribution.

 3. The names of the authors may not be used to endorse or promote products
 derived from this software without specific prior written permission.

 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function(obj) {

	function getTotalSize(entry) {
		var size = 0;

		function process(entry) {
			size += entry.uncompressedSize || 0;
			entry.children.forEach(process);
		}

		process(entry);
		return size;
	}

	function initReaders(entry, callback, onerror) {
		var index = 0;

		function next() {
			var child = entry.children[index];
			index++;
			if (index < entry.children.length)
				process(entry.children[index]);
			else
				callback();
		}

		function process(child) {
			if (child.directory)
				initReaders(child, next);
			else {
				if (child.data) {
					child.dataReader = new child.Reader(child.data, onerror);
					child.dataReader.init(function() {
						child.uncompressedSize = child.dataReader.size;
						next();
					});
				} else
					next();
			}
		}

		if (entry.children.length)
			process(entry.children[index]);
		else
			callback();
	}

	function detach(entry) {
		var children = entry.parent.children;
		children.forEach(function(child, index) {
			if (child.id == entry.id)
				children.splice(index, 1);
		});
	}

	var exportNext = (function() {
		var currentIndex = 0;

		return function process(zipWriter, entry, callback, onprogress, totalSize) {
			var childIndex = 0;

			function addChild(child) {
				function add(data) {
					if (!child.directory && !child.dataReader)
						child.dataReader = new child.Reader(data, onerror);
					zipWriter.add(child.getFullname(), child.directory ? null : child.dataReader, function() {
						currentIndex += child.uncompressedSize || 0;
						process(zipWriter, child, function() {
							childIndex++;
							exportChild();
						}, onprogress, totalSize);
					}, function(index) {
						if (onprogress)
							onprogress(currentIndex + index, totalSize);
					}, {
						directory : child.directory
					});
				}

				if (child.directory)
					add();
				else
					child.getData(child.Writer ? new child.Writer() : null, add);
			}

			function exportChild() {
				var child = entry.children[childIndex];
				if (child)
					addChild(child);
				else
					callback();
			}

			exportChild();
		};
	})();

	function resetFS(fs) {
		fs.entries = [];
		fs.root = new ZipEntry(fs, null, {
			directory : true
		});
	}

	function getEntryData(writer, callback, onprogress) {
		callback(this.data);
	}

	function addChild(parent, name, params) {
		if (parent.directory)
			return new ZipEntry(parent.fs, name, params, parent);
		else
			throw "Parent entry is not a directory.";
	}

	function ZipEntry(fs, name, params, parent) {
		var that = this;
		if (fs.root && parent && parent.getChildByName(name))
			throw "Entry filename already exists.";
		that.fs = fs;
		that.name = name;
		that.Reader = params.Reader;
		that.Writer = params.Writer;
		that.directory = params.directory;
		that.data = params.data;
		that.getData = params.getData || getEntryData;
		that.id = fs.entries.length;
		that.children = [];
		that.parent = parent;
		that.uncompressedSize = 0;
		fs.entries.push(that);
		if (parent)
			that.parent.children.push(that);
	}

	ZipEntry.prototype = {
		addDirectory : function(name) {
			return addChild(this, name, {
				directory : true
			});
		},
		addText : function(name, text) {
			return addChild(this, name, {
				data : text,
				Reader : obj.zip.TextReader
			});
		},
		addBlob : function(name, blob) {
			return addChild(this, name, {
				data : blob,
				Reader : obj.zip.BlobReader
			});
		},
		addData64URI : function(name, dataURI) {
			return addChild(this, name, {
				data : dataURI,
				Reader : obj.zip.Data64URIReader
			});
		},
		addHttpContent : function(name, URL, useRangeHeader) {
			return addChild(this, name, {
				data : URL,
				Reader : useRangeHeader ? obj.zip.HttpRangeReader : obj.zip.HttpReader
			});
		},
		addData : function(name, params) {
			return addChild(this, name, params);
		},
		getText : function(callback, onprogress) {
			this.getData(new obj.zip.TextWriter(), callback, onprogress);
		},
		getBlob : function(callback, onprogress) {
			this.getData(new obj.zip.BlobWriter(), callback, onprogress);
		},
		getData64URI : function(mimeType, callback, onprogress) {
			this.getData(new obj.zip.Data64URIWriter(mimeType), callback, onprogress);
		},
		getFile : function(fileEntry, callback, onprogress) {
			this.getData(new obj.zip.FileWriter(fileEntry), callback, onprogress);
		},
		importBlob : function(blob, onend, onerror) {
			this.importZip(new obj.zip.BlobReader(blob), onend, onerror);
		},
		importText : function(text, onend, onerror) {
			this.importZip(new obj.zip.TextReader(text), onend, onerror);
		},
		importData64URI : function(dataURI, onend, onerror) {
			this.importZip(new obj.zip.Data64URIReader(dataURI), onend, onerror);
		},
		importHttpContent : function(URL, useRangeHeader, onend, onerror) {
			this.importZip(useRangeHeader ? new obj.zip.HttpRangeReader(URL) : new obj.zip.HttpReader(URL), onend, onerror);
		},
		exportBlob : function(onend, onprogress, onerror) {
			this.exportZip(new obj.zip.BlobWriter(), onend, onprogress, onerror);
		},
		exportText : function(onend, onprogress, onerror) {
			this.exportZip(new obj.zip.TextWriter(), onend, onprogress, onerror);
		},
		exportFile : function(fileEntry, onend, onprogress, onerror) {
			this.exportZip(new obj.zip.FileWriter(fileEntry), onend, onprogress, onerror);
		},
		exportData64URI : function(mimeType, onend, onprogress, onerror) {
			this.exportZip(new obj.zip.Data64URIWriter(mimeType), onend, onprogress, onerror);
		},
		importZip : function(reader, onend, onerror) {
			var that = this;
			obj.zip.createReader(reader, function(zipReader) {
				zipReader.getEntries(function(entries) {
					entries.forEach(function(entry) {
						var parent = that, path = entry.filename.split("/"), name = path.pop(), importedEntry;
						path.forEach(function(pathPart) {
							parent = parent.getChildByName(pathPart) || new ZipEntry(that.fs, pathPart, {
								directory : true
							}, parent);
						});
						if (!entry.directory && entry.filename.charAt(entry.filename.length - 1) != "/") {
							importedEntry = addChild(parent, name, {
								Reader : obj.zip.BlobReader,
								Writer : obj.zip.BlobWriter,
								getData : function(writer, callback, onprogress) {
									entry.getData(writer, callback, onprogress);
								}
							});
							importedEntry.uncompressedSize = entry.uncompressedSize;
						}
					});
					onend();
				});
			}, onerror);
		},
		exportZip : function(writer, onend, onprogress, onerror) {
			var that = this;
			initReaders(that, function() {
				var totalSize = getTotalSize(that);
				obj.zip.createWriter(writer, function(zipWriter) {
					exportNext(zipWriter, that, function() {
						zipWriter.close(onend);
					}, onprogress, totalSize);
				}, onerror);
			}, onerror);
		},
		moveTo : function(target) {
			var that = this;
			if (target.directory) {
				if (!target.isDescendantOf(that)) {
					if (that != target) {
						if (target.getChildByName(that.name))
							throw "Entry filename already exists.";
						detach(that);
						that.parent = target;
						target.children.push(that);
					}
				} else
					throw "Entry is a ancestor of target entry.";
			} else
				throw "Target entry is not a directory.";
		},
		getChildByName : function(name) {
			var childIndex, child, that = this;
			for (childIndex = 0; childIndex < that.children.length; childIndex++) {
				child = that.children[childIndex];
				if (child.name == name)
					return child;
			}
		},
		getFullname : function() {
			var that = this, fullname = that.name, entry = that.parent;
			while (entry) {
				fullname = (entry.name ? entry.name + "/" : "") + fullname;
				entry = entry.parent;
			}
			return fullname;
		},
		isDescendantOf : function(ancestor) {
			var entry = this.parent;
			while (entry && entry.id != ancestor.id)
				entry = entry.parent;
			return !!entry;
		}
	};
	ZipEntry.prototype.constructor = ZipEntry;

	function FS() {
		resetFS(this);
	}
	FS.prototype = {
		remove : function(entry) {
			detach(entry);
			this.entries[entry.id] = null;
		},
		find : function(fullname) {
			var index, path = fullname.split("/"), node = this.root;
			for (index = 0; node && index < path.length; index++)
				node = node.getChildByName(path[index]);
			return node;
		},
		getById : function(id) {
			return this.entries[id];
		},
		importBlob : function(blob, onend, onerror) {
			resetFS(this);
			this.root.importBlob(blob, onend, onerror);
		},
		importText : function(text, onend, onerror) {
			resetFS(this);
			this.root.importText(text, onend, onerror);
		},
		importData64URI : function(dataURI, onend, onerror) {
			resetFS(this);
			this.root.importData64URI(dataURI, onend, onerror);
		},
		importHttpContent : function(URL, useRangeHeader, onend, onerror) {
			resetFS(this);
			this.root.importHttpContent(URL, useRangeHeader, onend, onerror);
		},
		exportBlob : function(onend, onprogress, onerror) {
			this.root.exportBlob(onend, onprogress, onerror);
		},
		exportText : function(onend, onprogress, onerror) {
			this.root.exportText(onend, onprogress, onerror);
		},
		exportFile : function(fileEntry, onend, onprogress, onerror) {
			this.root.exportFile(fileEntry, onend, onprogress, onerror);
		},
		exportData64URI : function(mimeType, onend, onprogress, onerror) {
			this.root.exportData64URI(mimeType, onend, onprogress, onerror);
		}
	};

	obj.zip.fs = {
		FS : FS
	};

})(this);

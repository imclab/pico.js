(function() {
    "use strict";
    
    var ImplClass = null;
    if (typeof webkitAudioContext !== "undefined") {
        ImplClass = function(sys) {
            var context = new webkitAudioContext();
            var bufSrc, jsNode;

            this.maxSamplerate     = context.sampleRate;
            this.defaultSamplerate = context.sampleRate;
            this.env = "webkit";
            
            var ua = navigator.userAgent;
            if (ua.match(/linux/i)) {
                sys.streammsec *= 8;
            } else if (ua.match(/win(dows)?\s*(nt 5\.1|xp)/i)) {
                sys.streammsec *= 4;
            }
            
            this.play = function() {
                var onaudioprocess;
                var jsn_streamsize = sys.getAdjustSamples(context.sampleRate);
                var sys_streamsize = sys.streamsize;
                var x, dx;
                
                if (sys.samplerate === context.sampleRate) {
                    onaudioprocess = function(e) {
                        var outs = e.outputBuffer;
                        sys.process();
                        outs.getChannelData(0).set(sys.strmL);
                        outs.getChannelData(1).set(sys.strmR);
                    };
                } else if (sys.samplerate * 2 === context.sampleRate) {
                    onaudioprocess = function(e) {
                        var inL = sys.strmL;
                        var inR = sys.strmR;
                        var outs = e.outputBuffer;
                        var outL = outs.getChannelData(0);
                        var outR = outs.getChannelData(1);
                        var i, imax = outs.length;
                        var j;
                        
                        sys.process();
                        for (i = j = 0; i < imax; i += 2, ++j) {
                            outL[i] = outL[i+1] = inL[j];
                            outR[i] = outR[i+1] = inR[j];
                        }
                    };
                } else {
                    x  = sys_streamsize;
                    dx = sys.samplerate / context.sampleRate;
                    onaudioprocess = function(e) {
                        var inL = sys.strmL;
                        var inR = sys.strmR;
                        var outs = e.outputBuffer;
                        var outL = outs.getChannelData(0);
                        var outR = outs.getChannelData(1);
                        var i, imax = outs.length;
                        
                        for (i = 0; i < imax; ++i) {
                            if (x >= sys_streamsize) {
                                sys.process();
                                x -= sys_streamsize;
                            }
                            outL[i] = inL[x|0];
                            outR[i] = inR[x|0];
                            x += dx;
                        }
                    };
                }
                
                bufSrc = context.createBufferSource();
                jsNode = context.createJavaScriptNode(jsn_streamsize, 2, sys.channels);
                jsNode.onaudioprocess = onaudioprocess;
                bufSrc.noteOn(0);
                bufSrc.connect(jsNode);
                jsNode.connect(context.destination);
            };
            
            this.pause = function() {
                bufSrc.disconnect();
                jsNode.disconnect();
            };
        };
    } else if (typeof Audio === "function" &&
               typeof (new Audio()).mozSetup === "function") {
        ImplClass = function(sys) {
            var timer = (function() {
                var source = "var t=0;onmessage=function(e){if(t)t=clearInterval(t),0;if(typeof e.data=='number'&&e.data>0)t=setInterval(function(){postMessage(0);},e.data);};";
                var blob = new Blob([source], {type:"text/javascript"});
                var path = URL.createObjectURL(blob);
                return new Worker(path);
            })();

            this.maxSamplerate     = 48000;
            this.defaultSamplerate = 44100;
            this.env = "moz";
            
            this.play = function() {
                var audio = new Audio();
                var interleaved = new Float32Array(sys.streamsize * sys.channels);
                var streammsec  = sys.streammsec;
                var written  = 0;
                var writtenIncr = sys.streamsize / sys.samplerate * 1000;
                var start = Date.now();
                
                var onaudioprocess = function() {
                    if (written > Date.now() - start) {
                        return;
                    }
                    var inL = sys.strmL;
                    var inR = sys.strmR;
                    var i = interleaved.length;
                    var j = inL.length;
                    sys.process();
                    while (j--) {
                        interleaved[--i] = inR[j];
                        interleaved[--i] = inL[j];
                    }
                    audio.mozWriteAudio(interleaved);
                    written += writtenIncr;
                };
                
                audio.mozSetup(sys.channels, sys.samplerate);
                timer.onmessage = onaudioprocess;
                timer.postMessage(streammsec);
            };
            
            this.pause = function() {
                timer.postMessage(0);
            };
        };
    } else {
        ImplClass = function(sys) {
            this.maxSamplerate     = 48000;
            this.defaultSamplerate =  8000;
            this.env = "nop";
            this.play  = function() {};
            this.pause = function() {};
        };
    }
    
    var ACCEPT_SAMPLERATES = [
        8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000
    ];
    var ACCEPT_CELLSIZES = [
        32,64,128,256
    ];
    
    function SoundSystem(opts) {
        this.impl = null;
        this.isPlaying  = false;
        this.samplerate = 44100;
        this.channels   = 2;
        this.cellsize   = 128;
        this.streammsec = 20;
        this.streamsize = 0;
        
        this.generator  = null;
    }
    
    SoundSystem.prototype.bind = function(klass, opts) {
        if (typeof klass === "function") {
            var player = new klass(this, opts);
            if (typeof player.play === "function" && typeof player.pause === "function") {
                this.impl = player;
                if (this.impl.defaultSamplerate) {
                    this.samplerate = this.impl.defaultSamplerate;
                }
            }
        }
        return this;
    };
    
    SoundSystem.prototype.setup = function(params) {
        if (typeof params === "object") {
            if (ACCEPT_SAMPLERATES.indexOf(params.samplerate) !== -1) {
                if (params.samplerate <= this.impl.maxSamplerate) {
                    this.samplerate = params.samplerate;
                } else {
                    this.samplerate = this.impl.maxSamplerate;
                }
            }
            if (ACCEPT_CELLSIZES.indexOf(params.cellsize) !== -1) {
                this.cellsize = params.cellsize;
            }
        } else if (typeof params === "string") {
            switch (params) {
            case "mobile":
                this.samplerate = 22050;
                this.cellsize   = 128;
                break;
            case "high-res":
                this.cellsize = 32;
                break;
            case "low-res":
                this.cellsize = 256;
                break;
            }
        } else {
            
        }
        return this;
    };
    
    SoundSystem.prototype.getAdjustSamples = function(samplerate) {
        var samples, bits;
        samplerate = samplerate || this.samplerate;
        samples = this.streammsec / 1000 * samplerate;
        bits = Math.ceil(Math.log(samples) * Math.LOG2E);
        bits = (bits < 8) ? 8 : (bits > 14) ? 14 : bits;
        return 1 << bits;
    };
    
    SoundSystem.prototype.play = function(generator) {
        if (this.isPlaying || typeof generator !== "object") {
            return this;
        }
        this.isPlaying = true;
        
        this.generator  = generator;
        this.streamsize = this.getAdjustSamples();
        this.strmL = new Float32Array(this.streamsize);
        this.strmR = new Float32Array(this.streamsize);
        this.cellL = new Float32Array(this.cellsize);
        this.cellR = new Float32Array(this.cellsize);
        
        this.impl.play();
        return this;
    };
    
    SoundSystem.prototype.pause = function() {
        if (this.isPlaying) {
            this.isPlaying = false;
            this.impl.pause();
        }
        return this;
    };
    
    SoundSystem.prototype.process = function() {
        var cellL = this.cellL, cellR = this.cellR;
        var strmL = this.strmL, strmR = this.strmR;
        var generator = this.generator;
        var i, imax = cellL.length;
        var j = 0, n = this.streamsize / this.cellsize;
        var x;
        
        while (n--) {
            generator.process(cellL, cellR);
            for (i = 0; i < imax; ++i, ++j) {
                x = cellL[i];
                strmL[j] = (x < -1) ? -1 : (x > 1) ? 1 : x;
                x = cellR[i];
                strmR[j] = (x < -1) ? -1 : (x > 1) ? 1 : x;
            }
        }
    };
    
    var instance = new SoundSystem().bind(ImplClass);
    
    var exports = {
        setup: function(opts) {
            instance.setup(opts);
            return this;
        },
        bind: function(klass, opts) {
            instance.bind(klass, opts);
            return this;
        },
        play: function(generator) {
            instance.play(generator);
            return this;
        },
        pause: function() {
            instance.pause();
            return this;
        }
    };
    Object.defineProperties(exports, {
        env: {
            get: function() {
                return instance.impl.env;
            }
        },
        samplerate: {
            get: function() {
                return instance.samplerate;
            }
        },
        channels: {
            get: function() {
                return instance.channels;
            }
        },
        cellsize: {
            get: function() {
                return instance.cellsize;
            }
        },
        isPlaying: {
            get: function() {
                return instance.isPlaying;
            }
        }
    });
    
    if (typeof module !== "undefined" && module.exports) {
        module.exports = global.pico = exports;
    } else if (typeof window !== "undefined") {
        if (typeof window.Float32Array === "undefined") {
            window.Float32Array = function(arg) {
                var a;
                if (Array.isArray(arg)) {
                    a = arg.slice();
                } else if (typeof arg === "number") {
                    a = new Array(arg);
                    for (var i = 0; i < arg; ++i) {
                        a[i] = 0;
                    }
                } else {
                    a = [];
                }
                a.set = function(array, offset) {
                    if (typeof offset === "undefined") {
                        offset = 0;
                    }
                    var i, imax = Math.min(this.length - offset, array.length);
                    for (i = 0; i < imax; ++i) {
                        this[offset + i] = array[i];
                    }
                };
                a.subarray = function(begin, end) {
                    if (typeof end === "undefined") {
                        end = this.length;
                    }
                    return new this.__klass(this.slice(begin, end));
                };
                return a;
            };
        }
        
        exports.noConflict = (function() {
            var _ = window.pico;
            return function() {
                if (window.pico === exports) {
                    window.pico = _;
                }
                return exports;
            };
        })();
        window.pico = exports;
    }
})();

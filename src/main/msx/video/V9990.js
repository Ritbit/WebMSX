// Copyright 2015 by Paulo Augusto Peccin. See license.txt distributed with this file.

// V9990 VDP
// This implementation is line-accurate
// Digitize, Superimpose, Color Bus, External Synch, B/W Mode, Wait Function not supported
// Original base clock: 2147727 Hz which is 6x CPU clock

wmsx.V9990 = function(machine, cpu) {
"use strict";

    var self = this;

    function init() {
        videoSignal = new wmsx.VideoSignal("V9990", self);
        initFrameResources(false);
        initColorCaches();
        initDebugPatternTables();
        initSpritesConflictMap();
        modeData = modes[-1];
        pendingBackdropCacheUpdate = true;
        self.setDefaults();
        commandProcessor = new wmsx.VDPCommandProcessor();
        commandProcessor.connectVDP(self, vram, register, oldStatus);
        commandProcessor.setVDPModeData(modeData);
    }

    this.setMachineType = function(machineType) {
        refreshDisplayMetrics();
    };

    this.connect = function(machine) {
        machine.vdp.connectSlave(this);
        machine.bus.connectInputDevice( 0x60, this.input60);
        machine.bus.connectOutputDevice(0x60, this.output60);
        machine.bus.connectInputDevice( 0x61, this.input61);
        machine.bus.connectOutputDevice(0x61, this.output61);
        machine.bus.connectInputDevice( 0x62, this.input62);
        machine.bus.connectOutputDevice(0x62, this.output62);
        machine.bus.connectInputDevice( 0x63, this.input63);
        machine.bus.connectOutputDevice(0x63, this.output63);
        machine.bus.connectInputDevice( 0x64, wmsx.DeviceMissing.inputPortIgnored);
        machine.bus.connectOutputDevice(0x64, this.output64);
        machine.bus.connectInputDevice( 0x65, this.input65);
        machine.bus.connectOutputDevice(0x65, wmsx.DeviceMissing.outputPortIgnored);
        machine.bus.connectInputDevice( 0x66, this.input66);
        machine.bus.connectOutputDevice(0x66, this.output66);
        machine.bus.connectInputDevice( 0x67, wmsx.DeviceMissing.inputPortIgnored);
        machine.bus.connectOutputDevice(0x67, this.output67);
        // 0x68 - 0x6f not used
    };

    this.disconnect = function(machine) {
        machine.vdp.connectSlave(undefined);
        machine.bus.disconnectInputDevice( 0x60, this.input60);
        machine.bus.disconnectOutputDevice(0x60, this.output60);
        machine.bus.disconnectInputDevice( 0x61, this.input61);
        machine.bus.disconnectOutputDevice(0x61, this.output61);
        machine.bus.disconnectInputDevice( 0x62, this.input62);
        machine.bus.disconnectOutputDevice(0x62, this.output62);
        machine.bus.disconnectInputDevice( 0x63, this.input63);
        machine.bus.disconnectOutputDevice(0x63, this.output63);
        machine.bus.disconnectInputDevice( 0x64, wmsx.DeviceMissing.inputPortIgnored);
        machine.bus.disconnectOutputDevice(0x64, this.output64);
        machine.bus.disconnectInputDevice( 0x65, this.input65);
        machine.bus.disconnectOutputDevice(0x65, wmsx.DeviceMissing.outputPortIgnored);
        machine.bus.disconnectInputDevice( 0x66, this.input66);
        machine.bus.disconnectOutputDevice(0x66, this.output66);
        machine.bus.disconnectInputDevice( 0x67, wmsx.DeviceMissing.inputPortIgnored);
        machine.bus.disconnectOutputDevice(0x67, this.output67);
        // 0x68 - 0x6f not used
    };

    this.powerOn = function() {
        this.reset();
    };

    this.powerOff = function() {
        videoSignal.signalOff();
    };

    this.setVideoStandard = function(pVideoStandard) {
        videoStandard = pVideoStandard;
        updateSynchronization();

        // logInfo("VideoStandard set: " + videoStandard.name);
    };

    this.setVSynchMode = function(mode) {
        vSynchMode = mode;
        updateSynchronization();
    };

    this.getVideoSignal = function() {
        return videoSignal;
    };

    this.getDesiredVideoPulldown = function () {
        return pulldown;
    };

    this.videoClockPulse = function() {
        // Generate correct amount of lines per cycle, according to the current pulldown cadence
        cycleEvents();

        // Send updated image to Monitor if needed
        if (refreshWidth) refresh();
    };

    // VRAM Data Read
    this.input60 = function() {
        var res = vramReadData;
        if (vramPointerReadInc)
            if (++vramPointerRead > VRAM_LIMIT) vramPointerRead &= VRAM_LIMIT ;
        vramReadData = vram[vramPointerRead];
        return res;
    };

    // VRAM Data Write
    this.output60 = function(val) {
        vram[vramPointerWrite] = val;
        if (vramPointerWriteInc)
            if (++vramPointerWrite > VRAM_LIMIT) vramPointerWrite &= VRAM_LIMIT ;
    };

    // Palette Data Read
    this.input61 = function() {
        if ((palettePointer & 0x03) === 3) {
            // Dummy read and stay at same RGB entry
            if (palletePointerInc) palettePointer &= 0xfc;
            return 0;
        }
        var res = paletteData[palettePointer];
        if (palletePointerInc) {
            if ((palettePointer & 0x03) === 2) palettePointer = (palettePointer + 2) & 0xff;    // Jump one byte to the next RGB entry
            else ++palettePointer;
        }
        return res;
    };

    // Palette Data Write
    this.output61 = function(val) {
        if ((palettePointer & 0x03) === 3) {
            // Ignore write and stay at same RGB entry
            if (palletePointerInc) palettePointer &= 0xfc;
            return;
        }
        paletteData[palettePointer] = val & 0x1f;                                               // 5 bits R/G/B, ignore YS bit for now
        if (palletePointerInc) {
            if ((palettePointer & 0x03) === 2) palettePointer = (palettePointer + 2) & 0xff;    // Jump one byte to the next RGB entry
            else ++palettePointer;
        }
    };

    // Command Data Read
    this.input62 = function() {
    };

    // Command Data Write
    this.output62 = function(val) {
    };

    // Register Data Read
    this.input63 = function() {
        var res = register[registerSelect];
        if (registerSelectReadInc)
            if (++registerSelect > 0x3f) registerSelect &= 0x3f;
        return res;
    };

    // Register Data Write
    this.output63 = function(val) {
        registerWrite(registerSelect, val);
        if (registerSelectWriteInc)
            if (++registerSelect > 0x3f) registerSelect &= 0x3f;
    };

    // Register Select Write
    this.output64 = function(val) {
        registerSelect = val & 0x3f;
        registerSelectWriteInc = (val & 0x80) === 0;
        registerSelectReadInc =  (val & 0x40) === 0;
    };

    // Status Read
    this.input65 = function() {
        return status;
    };

    // Interrupt Flags Read
    this.input66 = function() {
        return interruptFlags;
    };

    // Interrupt Flags Write
    this.output66 = function(val) {
        interruptFlags &= ~val;
    };

    // System Control Write
    this.output67 = function(val) {
        var mod = systemControl ^ val;
        systemControl = val;
        if (mod & 0x01) updateMode();       // MCS
    };

    this.toggleDebugModes = function(dec) {
        setDebugMode(debugMode + (dec ? -1 : 1));
        videoSignal.showOSD("Debug Mode" + (debugMode > 0 ? " " + debugMode : "") + ": "
            + [ "OFF", "Sprites Highlighted", "Sprite Numbers", "Sprite Names",
                "Sprites Hidden", "Pattern Bits", "Pattern Color Blocks", "Pattern Names"][debugMode], true);
        return debugMode;
    };

    this.toggleSpriteDebugModes = function(dec) {
        setSpriteDebugMode(spriteDebugMode + (dec ? -1 : 1));
        videoSignal.showOSD("Sprites Mode" + (spriteDebugMode > 0 ? " " + spriteDebugMode : "") + ": "
            + ["Normal", "Unlimited", "NO Collisions", "Unlimited, No Collisions"][spriteDebugMode], true);
    };

    this.getSpriteDebugModeQuickDesc = function() {
        return ["Normal", "Unlimited", "No Collis.", "Both"][spriteDebugMode];
    };

    this.setVDPTurboMulti = function(multi) {
        commandProcessor.setVDPTurboMulti(multi);
    };

    this.getVDPTurboMulti = function() {
        return commandProcessor.getVDPTurboMulti();
    };

    this.setDefaults = function() {
        setDebugMode(STARTING_DEBUG_MODE);
        setSpriteDebugMode(STARTING_SPRITES_DEBUG_MODE);
    };

    this.reset = function() {
        status = 0; interruptFlags = 0; systemControl = 0;
        registerSelect = 0; registerSelectReadInc = true; registerSelectWriteInc = true;
        vramPointerRead = 0; vramPointerWrite = 0; vramPointerReadInc = true; vramPointerWriteInc = true; vramReadData = 0;
        palettePointer = 0; palletePointerInc = true;


        frame = cycles = lastBUSCyclesComputed = 0;
        verticalAdjust = horizontalAdjust = 0;
        leftMask = leftScroll2Pages = false; leftScrollChars = leftScrollCharsInPage = rightScrollPixels = 0;
        backdropColor = backdropValue = 0;
        spritesCollided = false; spritesCollisionX = spritesCollisionY = spritesInvalid = -1; spritesMaxComputed = 0;
        verticalIntReached = false; horizontalIntLine = 0;
        vramInterleaving = false;
        renderMetricsChangePending = false;
        refreshWidth = refreshHeight = 0;
        frameVideoStandard = videoStandard; framePulldown = pulldown;
        currentScanline = -1;
        initRegisters();
        initColorPalette();
        commandProcessor.reset();
        updateSignalMetrics(true);
        updateIRQ();
        updateMode();
        updateSpritesConfig();
        updateBackdropColor();
        updateTransparency();
        updateSynchronization();
        updateBlinking();
        beginFrame();
    };

    this.updateCycles = function() {
        var busCycles = cpu.getBUSCycles();
        if (busCycles === lastBUSCyclesComputed) return cycles;

        var elapsed = (busCycles - lastBUSCyclesComputed) * 6;
        lastBUSCyclesComputed = busCycles;
        cycles += elapsed;

        return cycles;
    };

    this.getScreenText = function() {
        var cols = modeData.textCols;
        if (!cols) return null;

        var lines = (register[9] & 0x80) ? 27 : 24;
        var linesStr = [];

        for (var line = 0; line < lines; ++line) {
            linesStr.push(wmsx.Util.int8BitArrayToByteString(vram, layoutTableAddress + line * cols, cols).replace(/\s+$/,""));      // right trim
        }

        return linesStr.join("\n").replace(/[\x00\xff]/g, " ").replace(/\s+$/,"");      // right trim
    };

    function updateVRAMReadPointer() {
        vramPointerRead = ((register[5] << 16) | (register[4] << 8) | register[3]) & VRAM_LIMIT;
        vramPointerReadInc = !(register[5] & 0x80);
        vramReadData = vram[vramPointerRead];
    }

    function updateVRAMWritePointer() {
        vramPointerWrite = ((register[2] << 16) | (register[1] << 8) | register[0]) & VRAM_LIMIT;
        vramPointerWriteInc = !(register[2] & 0x80);
    }

    function updatePalettePointer() {
        palettePointer = register[14];
    }

    function updatePalettePointerInc() {
        palletePointerInc = (register[13] & 0x10) === 0;
    }

    function registerWrite(reg, val) {
        if (reg > 54) return;

        var add;
        var mod = register[reg] ^ val;
        register[reg] = val;

        // logInfo("Reg: " + reg + " = " + val.toString(16));

        switch (reg) {
            case 2:
                updateVRAMWritePointer();
                break;
            case 5:
                updateVRAMReadPointer();
                break;
            case 6:
                if (mod & 0xf0) updateMode();                // DSPM1, DSPM0, DCKM1, DCKM0
                break;
            case 7:
                if (mod & 0x08) updateVideoStandardSoft();   // PAL
                if (mod & 0x40) updateMode();                // C25M
                break;
            case 8:
                if (mod & 0x80) {                            // DISP
                    blankingChangePending = true;            // only at next line
                    //logInfo("Blanking: " + !!(val & 0x40));
                }
                break;
            case 9:
                if (mod & 0x07) updateIRQ();                // IECE, IEH, IEV
                break;
            case 13:
                if (mod & 0x10) updatePalettePointerInc();  // PLTAIH
                break;
            case 14:
                updatePalettePointer();
                break;
            case 15:
                if (mod & 0x3f) updateBackdropColor();      // BDC
                break;
        }


        return;

        switch (reg) {

            case 1:
                //if (mod) logInfo("Register1: " + val.toString(16));

                if (mod & 0x40) {                                        // BL
                    blankingChangePending = true;      // only at next line

                    //logInfo("Blanking: " + !!(val & 0x40));
                }
                if (mod & 0x18) updateMode();                            // Mx
                if (mod & 0x04) updateBlinking();                        // CDR  (Undocumented, changes reg 13 timing to lines instead of frames)
                if (mod & 0x03) updateSpritesConfig();                   // SI, MAG
                break;
            case 10:
                if ((mod & 0x07) === 0) break;
                // else fall through
            case 3:
                add = ((register[10] << 14) | (register[3] << 6)) & 0x1ffff;
                colorTableAddress = add & modeData.colorTBase;
                colorTableAddressMask = add | colorTableAddressMaskBase;

                //logInfo("Setting: " + val.toString(16) + " to ColorTableAddress: " + colorTableAddress.toString(16));

                break;
            case 4:
                if ((mod & 0x3f) === 0) break;
                add = (val << 11) & 0x1ffff;
                patternTableAddress = add & modeData.patTBase;
                patternTableAddressMask = add | patternTableAddressMaskBase;

                //logInfo("Setting: " + val.toString(16) + " to PatternTableAddress: " + patternTableAddress.toString(16));

                break;
            case 11:
                if ((mod & 0x03) === 0) break;
                // else fall through
            case 5:
                add = ((register[11] << 15) | (register[5] << 7)) & 0x1ffff;
                spriteAttrTableAddress = add & modeData.sprAttrTBase;

                //logInfo("SpriteAttrTable: " + spriteAttrTableAddress.toString(16));

                break;
            case 6:
                if (mod & 0x3f) updateSpritePatternTableAddress();
                break;
            case 7:
                if (mod & (modeData.bdPaletted ? 0x0f : 0xff)) updateBackdropColor();  // BD
                break;
            case 8:
                if (mod & 0x20) updateTransparency();                    // TP
                if (mod & 0x02) updateSpritesConfig();                   // SPD
                break;
            case 9:
                if (mod & 0x80) updateSignalMetrics(false);              // LN
                if (mod & 0x08) updateRenderMetrics(false);              // IL
                if (mod & 0x04) updateLayoutTableAddressMask();          // EO
                if (mod & 0x02) updateVideoStandardSoft();               // NT
                break;
            case 13:
                updateBlinking();                                        // Always, even with no change
                break;
            case 14:
                if (mod & 0x07) vramPointerWrite = ((val & 0x07) << 14) | (vramPointerWrite & 0x3fff);

                //console.log("Setting reg14: " + val.toString(16) + ". VRAM Pointer: " + vramPointer.toString(16));

                break;
            case 18:
                if (mod & 0x0f) horizontalAdjust = -7 + ((val & 0x0f) ^ 0x07);
                if (mod & 0xf0) {
                    verticalAdjust = -7 + ((val >>> 4) ^ 0x07);
                    updateSignalMetrics(false);
                }
                break;
            case 19:
                horizontalIntLine = (val - register[23]) & 255;

                // logInfo("Line Interrupt set: " + val + ", reg23: " + register[23]);

                break;
            case 23:
                horizontalIntLine = (register[19] - val) & 255;

                //logInfo("Vertical offset set: " + val);

                break;
            case 25:
                if (mod & 0x18) updateMode();                        // YJK, YAE
                leftMask = (val & 0x02) !== 0;                       // MSK
                leftScroll2Pages = (val & 0x01) !== 0;               // SP2
                break;
            case 26:
                leftScrollChars = val & 0x3f;                        // H08-H03
                leftScrollCharsInPage = leftScrollChars & 31;
                break;
            case 27:
                rightScrollPixels = val & 0x07;             // H02-H01

                // logInfo("Reg17 - Right Scroll set: " + val);

                break;
            case 44:
                commandProcessor.cpuWrite(val);
                break;
            case 46:
                commandProcessor.startCommand(val);
                break;
        }
    }

    function updateLayoutTableAddress() {
        // Interleaved modes (G6, G7, YJK, YAE) have different address bits position in reg 2. Only A16 can be specified for base address, A10 always set in mask
        var add = modeData.vramInter ?((register[2] & 0x3f) << 11) | (1 << 10) : (register[2] & 0x7f) << 10;

        layoutTableAddress =  add & modeData.layTBase;
        layoutTableAddressMaskSetValue = add | layoutTableAddressMaskBase;
        updateLayoutTableAddressMask();

        //logInfo(/* "Setting: " + reg.toString(16) + " to " + */ "LayoutTableAddress: " + layoutTableAddress.toString(16));
    }

    // Consider Alternative Page (EO and Blink)
    function updateLayoutTableAddressMask() {
        layoutTableAddressMask = layoutTableAddressMaskSetValue &
            (blinkEvenPage || ((register[9] & 0x04) && (oldStatus[2] & 0x02) === 0) ? modeData.blinkPageMask : ~0);
    }

    function updateSpritePatternTableAddress() {
        spritePatternTableAddress = debugModeSpriteInfo
            ? spritesSize === 16 ? DEBUG_PAT_DIGI16_TABLE_ADDRESS : DEBUG_PAT_DIGI8_TABLE_ADDRESS
            : (register[6] << 11) & 0x1ffff;

        //logInfo("SpritePatTable: " + spritePatternTableAddress.toString(16));
    }

    function paletteRegisterWrite(reg, val, force) {
        if (paletteData[reg] === val && !force) return;

        //logInfo("Palette register " + reg + ": " + val);

        paletteData[reg] = val;

        var value = colors512[((val & 0x700) >>> 2) | ((val & 0x70) >>> 1) | (val & 0x07)];     // 11 bit GRB to 9 bit GRB
        colorPaletteReal[reg] = value;

        if (debugModeSpriteHighlight) value &= DEBUG_DIM_ALPHA_MASK;
        colorPaletteSolid[reg] = value;
        // Special case for color 0
        if (reg === 0) {
            if (color0Solid) colorPalette[0] = value;
        } else
            colorPalette[reg] = value;

        if (reg === backdropColor) updateBackdropValue();
        else if (modeData.tiled && reg <= 3) pendingBackdropCacheUpdate = true;
    }

    function setDebugMode(mode) {
        debugMode = (mode + 8) % 8;
        var oldDebugModeSpriteHighlight = debugModeSpriteHighlight;
        debugModeSpriteHighlight = debugMode >= 1 && debugMode <= 3;
        debugModeSpriteInfo = debugMode === 2 || debugMode === 3;
        debugModeSpriteInfoNumbers = debugMode === 2;
        // mode 3 is SpriteInfoName
        debugModeSpritesHidden = debugMode >= 4;
        var oldDebugModePatternInfo = debugModePatternInfo;
        debugModePatternInfo = debugMode >= 5;
        debugModePatternInfoBlocks = debugMode === 6;
        debugModePatternInfoNames = debugMode === 7;
        if (oldDebugModeSpriteHighlight !== debugModeSpriteHighlight || oldDebugModePatternInfo !== debugModePatternInfo) debugAdjustPalette();
        initFrameResources(debugModeSpriteHighlight);
        updateLineActiveType();
        updateSpritesConfig();
        updateSpritePatternTableAddress();
        videoSignal.setDebugMode(debugMode > 0);
    }

    function setSpriteDebugMode(mode) {
        spriteDebugMode = mode >= 0 ? mode % 4 : 4 + mode;
        spriteDebugModeLimit = (spriteDebugMode === 0) || (spriteDebugMode === 2);
        spriteDebugModeCollisions = spriteDebugMode < 2;
    }

    function debugAdjustPalette() {
        for (var reg = 0; reg < 16; reg++) paletteRegisterWrite(reg, paletteData[reg], true);
    }

    function updateSynchronization() {
        // According to the native video frequency detected, target Video Standard and vSynchMode, use a specific pulldown configuration
        if (vSynchMode === 1) {    // ON
            // Will V-synch to host freq if detected and supported, or use optimal timer configuration)
            pulldown = videoStandard.pulldowns[machine.getVideoClockSocket().getVSynchNativeFrequency()] || videoStandard.pulldowns.TIMER;
        } else {                        // OFF, DISABLED
            // No V-synch. Always use the optimal timer configuration)
            pulldown = videoStandard.pulldowns.TIMER;
        }

        // console.log("Update Synchronization. Pulldown " + pulldown.standard + " " + pulldown.frequency);
    }

    this.cycleEventRefresh = function() {
        refresh();
    };

    // Total line clocks: VDP: 1368, CPU: 228, PSG 7.125
    // Timing should be different for mode T1 and T2 since borders are wider. Ignoring for now.
    function lineEvents() {
        // Start of line
        // debugLineStartBUSCycles = cpu.getBUSCycles();

        // Page blinking per line (undocumented CDR bit set)
        if (blinkPerLine && blinkPageDuration > 0)
            if (clockPageBlinking()) updateLayoutTableAddressMask();

        // Verify and change sections of the screen
        if (currentScanline === startingActiveScanline) setActiveDisplay();
        else if (currentScanline - frameStartingActiveScanline === signalActiveHeight) setBorderDisplay();

        // Sync signal: 100 clocks
        // Left erase: 102 clocks


        // Left border: 56 clocks

        if (blankingChangePending) updateLineActiveType();

        if ((oldStatus[1] & 0x01) && ((register[0] & 0x10) === 0))  oldStatus[1] &= ~0x01;                // FH = 0 if interrupts disabled (IE1 = 0)
        if (currentScanline === startingActiveScanline - 1) oldStatus[2] &= ~0x40;                     // VR = 0 at the scanline before first Active scanline
        else if (currentScanline - frameStartingActiveScanline === signalActiveHeight)              // VR = 1, F = 1 at the first Bottom Border line
            triggerVerticalInterrupt();

        // Active Display: 1024 clocks

        oldStatus[2] &= ~0x20;                                                                         // HR = 0


        // ~ Middle of Active Line

        if (currentScanline >= startingVisibleTopBorderScanline
            && currentScanline < startingInvisibleScanline) renderLine();                           // Only render if visible


        // End of Active Display

        oldStatus[2] |= 0x20;                                                                          // HR = 1
        if (currentScanline - frameStartingActiveScanline === horizontalIntLine)
            triggerHorizontalInterrupt();                                                           // FH = 1

        // Right border: 59 clocks
        // Right erase: 27 clocks

        // End of line
    }

    this.lineEventRenderLine = function() {
        if (currentScanline >= startingVisibleTopBorderScanline
            && currentScanline < startingInvisibleScanline) renderLine();                           // Only render if visible
    };

    this.lineEventEndOfActiveDisplay = function() {
        oldStatus[2] |= 0x20;                                                                       // HR = 1
        if (currentScanline - frameStartingActiveScanline === horizontalIntLine)
            triggerHorizontalInterrupt();
        if (currentScanline - frameStartingActiveScanline === signalActiveHeight)
            triggerVerticalInterrupt();

    };

    this.lineEventEnd = function() {
        currentScanline = currentScanline + 1;
        if (currentScanline >= finishingScanline) finishFrame();
    };

    function triggerVerticalInterrupt() {
        if (interruptFlags & 0x01) return;          // VI already == 1 ?
        interruptFlags |= 0x01;                     // VI = 1
        updateIRQ();

        // logInfo("Vertical Frame Int reached. Ints " + ((register[1] & 0x20) ?  "ENABLED" : "disabled"));
    }

    function triggerHorizontalInterrupt() {
        // logInfo("Horizontal Int Line reached. Ints " + ((register[0] & 0x10) ?  "ENABLED" : "disabled"));
    }

    function updateIRQ() {
        if ((register[9] & 0x01) && (interruptFlags & 0x01)) {      // IEV == 1 & VI == 1
            cpu.setINTChannel(1, 0);                                // V9990 using fixed channel 1. TODO INT Multiple V9990 connected?

            // logInfo(">>>  INT ON");
        } else {
            cpu.setINTChannel(1, 1);

            // logInfo(">>>  INT OFF");
        }
    }

    function updateVRAMInterleaving() {
        if (modeData.vramInter === true && !vramInterleaving) vramEnterInterleaving();
        else if (modeData.vramInter === false && vramInterleaving) vramExitInterleaving();
    }

    function vramEnterInterleaving() {
        return;

        var e = 0;
        var o = VRAM_LIMIT >> 1;
        var aux = vram.slice(0, o);                 // Only first halt needs to be saved. Verify: Optimize slice?
        for (var i = 0; i < VRAM_LIMIT; i += 2) {
            vram[i] = aux[e++];
            vram[i + 1] = vram[o++];
        }
        vramInterleaving = true;

        //console.log("VRAM ENTERING Interleaving");
    }

    function vramExitInterleaving() {
        return;

        var h = VRAM_LIMIT >> 1;
        var e = 0;
        var o = h;
        var aux = vram.slice(h);                    // Only last half needs to be saved. Verify: Optimize slice?
        for (var i = 0; i < h; i += 2) {
            vram[e++] = vram[i];
            vram[o++] = vram[i + 1];
        }
        for (i = 0; i < h; i += 2) {
            vram[e++] = aux[i];
            vram[o++] = aux[i + 1];
        }
        vramInterleaving = false;

        //console.log("VRAM EXITING Interleaving");
    }

    function updateMode() {
        // MCS C25M DSPM1 DSPM0 DCKM1 DCKM0
        var modeBits = ((systemControl & 0x01) << 5) | ((register[7] & 0x40) >> 2) | (register[6] >> 4);

        modeData = modes[modeBits] || modes[-1];

        updateVRAMInterleaving();
        updateLineActiveType();
        updateRenderMetrics(false);

        logInfo("Update Mode: " + modeData.name + ", modeBits: " + modeBits.toString(16));
    }

    function updateVideoStandardSoft() {
        var pal = (register[7] & 0x08) !== 0;
        machine.setVideoStandardSoft(pal ? wmsx.VideoStandard.PAL : wmsx.VideoStandard.NTSC);

        //logInfo("VideoStandard soft: " + (pal ? "PAL" : "NTSC"));
    }

    function updateSignalMetrics(force) {
        var addBorder;

        if (register[9] & 0x80) { signalActiveHeight = 212; addBorder = 0; }             // LN
        else { signalActiveHeight = 192; addBorder = 10; }

        // UX decision: Visible border height with LN = 1 and no Vertical Adjust is 8
        startingVisibleTopBorderScanline = 16 - 8;                                                              // Minimal Border left invisible (NTSC with LN = 0)
        startingActiveScanline = startingVisibleTopBorderScanline + 8 + addBorder + verticalAdjust;
        var startingVisibleBottomBorderScanline = startingActiveScanline + signalActiveHeight;
        startingInvisibleScanline = startingVisibleBottomBorderScanline + 8 + addBorder - verticalAdjust;       // Remaining Bottom border and other parts left invisible
        finishingScanline = frameVideoStandard.totalHeight;

        if (force) frameStartingActiveScanline = startingActiveScanline;

        // logInfo("Update Signal Metrics: " + force + ", activeHeight: " + signalActiveHeight);
    }

    function updateRenderMetrics(force) {
        var newRenderWidth, newRenderHeight, newPixelWidth, newPixelHeight, changed = false;

        if (modeData.width === 512) { newRenderWidth = 512 + 16 * 2; newPixelWidth = 1; }   // Mode
        else { newRenderWidth = 256 + 8 * 2; newPixelWidth = 2; }
        if (register[9] & 0x08) { newRenderHeight = 424 + 16 * 2; newPixelHeight = 1; }     // IL
        else { newRenderHeight = 212 + 8 * 2; newPixelHeight = 2; }

        renderMetricsChangePending = false;

        if (newRenderWidth === renderWidth && newRenderHeight === renderHeight) return;

        // Only change width if before visible display (beginFrame), or if going to higher width
        if (newRenderWidth !== renderWidth) {
            if (currentScanline < startingVisibleTopBorderScanline || newRenderWidth > renderWidth) {
                if (currentScanline >= startingVisibleTopBorderScanline) stretchFromCurrentToTopScanline();
                renderWidth = newRenderWidth;
                changed = true;
            } else
                renderMetricsChangePending = true;
        }

        // Only change height if forced (loadState and beginFrame)
        if (newRenderHeight !== renderHeight) {
            if (force) {
                cleanFrameBuffer();
                renderHeight = newRenderHeight;
                changed = true;
            } else
                renderMetricsChangePending = true;
        }

        if (changed) videoSignal.setPixelMetrics(newPixelWidth, newPixelHeight);

        //logInfo("Update Render Metrics. " + force + " Asked: " + newRenderWidth + "x" + newRenderHeight + ", set: " + renderWidth + "x" + renderHeight);
    }

    function setActiveDisplay() {
        renderLine = renderLineActive;
    }

    function setBorderDisplay() {
        renderLine = renderLineBorders;
    }

    function updateLineActiveType() {
        var wasActive = renderLine === renderLineActive;

        renderLineActive = (register[6] & 0x80) === 0 ? renderLineBlanked           // DISP
            // : debugModePatternInfo ? modeData.renderLinePatInfo
            : modeData.renderLine;

        if (wasActive) renderLine = renderLineActive;
        blankingChangePending = false;
    }

    function updateSpritesConfig() {
        spritesEnabled = !debugModeSpritesHidden && (register[8] & 0x02) === 0;        // SPD
        spritesSize = (register[1] & 0x02) ? 16 : 8;        // SI
        spritesMag = register[1] & 0x01;                    // MAG

        //logInfo("Sprites enabled: " + spritesEnabled + ", size: " + spritesSize + ", mag: " + spritesMag);
    }

    function updateTransparency() {
        color0Solid = (register[8] & 0x20) !== 0;
        colorPalette[0] = color0Solid ? colorPaletteSolid[0] : backdropValue;

        //console.log("TP: " + color0Solid + ", currentLine: " + currentScanline);
    }

    function updateBackdropColor() {
        backdropColor = register[15] & 0x3f;

        //console.log("Backdrop Color: " + backdropColor + ", currentLine: " + currentScanline);

        updateBackdropValue();
    }

    function updateBackdropValue() {
        var value = debugModePatternInfo ? debugBackdropValue : colorPaletteSolid[backdropColor];
        if (backdropValue === value) return;

        backdropValue = value;
        colorPalette[0] = backdropValue;
        pendingBackdropCacheUpdate = true;

        //logInfo("Backdrop Value: " + backdropValue.toString(16));
    }

    function updateBackdropFullLineCache() {
        wmsx.Util.arrayFill(backdropFullLineCache, backdropValue);

        pendingBackdropCacheUpdate = false;

        //console.log("Update BackdropCaches");
    }

    function updateBlinking() {
        blinkPerLine = (register[1] & 0x04) !== 0;               // Ser blinking speed per line instead od per frame, based on undocumented CDR but
        if ((register[13] >>> 4) === 0) {
            blinkEvenPage = false; blinkPageDuration = 0;        // Force page to be fixed on the Odd page
        } else if ((register[13] & 0x0f) === 0) {
            blinkEvenPage = true;  blinkPageDuration = 0;        // Force page to be fixed on the Even page
        } else {
            blinkEvenPage = true;  blinkPageDuration = 1;        // Force next page to be the Even page and let alternance start
        }
        updateLayoutTableAddressMask();                          // To reflect correct page
    }

    function clockPageBlinking() {
        if (--blinkPageDuration === 0) {
            blinkEvenPage = !blinkEvenPage;
            blinkPageDuration = ((register[13] >>> (blinkEvenPage ? 4 : 0)) & 0x0f) * 10;   // Duration in frames or lines depending on undocumented CDR bit
            return true;
        }
        return false;
    }

    function renderLineBorders() {
        if (pendingBackdropCacheUpdate) updateBackdropFullLineCache();
        frameBackBuffer.set(backdropFullLineCache, bufferPosition);
        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineBlanked() {
        renderLineBorders();
    }

    function getRealLine() {
        return (currentScanline - frameStartingActiveScanline + register[23]) & 255;
    }

    // V9958: Only Left Masking and Right Pixel Scroll supported. Left Char Scroll and Scroll Pages not supported
    function renderLineModeT1() {                                           // Text (Screen 0 width 40)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var colorCode = register[7];                                        // fixed text color for all line
        var lineInPattern = patternTableAddress + (realLine & 0x07);
        var on =  colorPalette[colorCode >>> 4];
        var off = colorPalette[colorCode & 0xf];

        var namePos = layoutTableAddress + (realLine >>> 3) * 40;

        paintBackdrop8(bufferPos); bufferPos += 8;                          // Text padding
        for (var c = 0; c < 40; ++c) {
            var name = vram[namePos++];                                     // no masking needed
            var pattern = vram[(name << 3) + lineInPattern];                // no masking needed
            paintPattern6(bufferPos, pattern, on, off);
            bufferPos += 6;
        }
        paintBackdrop8(bufferPos); bufferPos += 8;                          // Text padding
        bufferPos -= rightScrollPixels + 256;

        // Sprites deactivated
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    // V9958: Only Left Masking and Right Pixel Scroll supported. Left Char Scroll and Scroll Pages not supported
    function renderLineModeT2() {                                           // Text (Screen 0 width 80)
        paintBackdrop32(bufferPosition); paintBackdrop32(bufferPosition + 512);

        var bufferPos = bufferPosition + 16 + ((horizontalAdjust + rightScrollPixels) << 1);
        var realLine = getRealLine();
        var lineInPattern = patternTableAddress + (realLine & 0x07);
        var name, pattern, colorCode, on, off;

        var namePos = layoutTableAddress + (realLine >>> 3) * 80;

        paintBackdrop16(bufferPos); bufferPos += 16;                        // Text padding
        if (blinkEvenPage) {                                                // Blink only in Even page
            var blinkPos = colorTableAddress + (realLine >>> 3) * 10;
            var blinkBit = 7;
            for (var c = 0; c < 80; ++c) {
                var blink = (vram[blinkPos & colorTableAddressMask] >>> blinkBit) & 1;
                name = vram[namePos++ & layoutTableAddressMask];
                colorCode = register[blink ? 12 : 7];                       // special colors from register12 if blink bit for position is set
                pattern = vram[(name << 3) + lineInPattern];                // no masking needed
                on = blink ? colorPaletteSolid[colorCode >>> 4] : colorPalette[colorCode >>> 4];    // color 0 is always solid in blink
                off = blink ? colorPaletteSolid[colorCode & 0xf] : colorPalette[colorCode & 0xf];
                paintPattern6(bufferPos, pattern, on, off);
                if (--blinkBit < 0) { blinkPos++; blinkBit = 7; }
                bufferPos += 6;
            }
        } else {
            colorCode = register[7];
            on =  colorPalette[colorCode >>> 4];
            off = colorPalette[colorCode & 0xf];
            for (c = 0; c < 80; ++c) {
                name = vram[namePos++ & layoutTableAddressMask];
                pattern = vram[(name << 3) + lineInPattern];                // no masking needed
                paintPattern6(bufferPos, pattern, on, off);
                bufferPos += 6;
            }
        }
        paintBackdrop16(bufferPos); bufferPos += 16;                        // Text padding
        bufferPos -= (rightScrollPixels << 1) + 512;

        // Sprites deactivated
        if (leftMask) paintBackdrop16(bufferPos); // { paintPattern8(bufferPos, 255, 0xff0000ff, 0); paintPattern8(bufferPos + 8, 255, 0xff0000ff, 0); }
        if (rightScrollPixels) paintBackdrop16(bufferPos + 512); // { paintPattern8(bufferPos + 512, 255, 0xff0000ff, 0); paintPattern8(bufferPos + 512 + 8, 255, 0xff0000ff, 0); }

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeMC() {                                           // Multicolor (Screen 3)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var extraPatPos = patternTableAddress + (((realLine >>> 3) & 0x03) << 1) + ((realLine >>> 2) & 0x01);    // (pattern line % 4) * 2

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;    // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++];                                     // no masking needed
            var patternLine = (name << 3) + extraPatPos;                    // name * 8 + extra position, no masking needed
            var colorCode = vram[patternLine];                              // no masking needed
            var on =  colorPalette[colorCode >>> 4];
            var off = colorPalette[colorCode & 0xf];
            paintPattern8(bufferPos, 0xf0, on, off);                        // always solid blocks of front and back colors;
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        renderSpritesLineMode1(realLine, bufferPos);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG1() {                                           // Graphics 1 (Screen 1)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var lineInPattern = patternTableAddress + (realLine & 0x07);

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;    // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++];                                     // no masking needed
            var colorCode = vram[colorTableAddress + (name >>> 3)];         // name / 8 (1 color for each 8 patterns), no masking needed
            var pattern = vram[((name << 3) + lineInPattern)];              // name * 8 (8 bytes each pattern) + line inside pattern, no masking needed
            var on =  colorPalette[colorCode >>> 4];
            var off = colorPalette[colorCode & 0xf];
            paintPattern8(bufferPos, pattern, on, off);
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        renderSpritesLineMode1(realLine, bufferPos);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG2() {                                           // Graphics 2 (Screen 2)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var lineInColor = colorTableAddress + (realLine & 0x07);
        var lineInPattern = patternTableAddress + (realLine & 0x07);
        var blockExtra = (realLine & 0xc0) << 2;                            // + 0x100 for each third block of the screen (8 pattern lines)

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;     // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++] | blockExtra;                                       // no masking needed
            var colorCode = vram[((name << 3) + lineInColor) & colorTableAddressMask];     // (8 bytes each pattern) + line inside pattern
            var pattern = vram[((name << 3) + lineInPattern) & patternTableAddressMask];
            var on =  colorPalette[colorCode >>> 4];
            var off = colorPalette[colorCode & 0xf];
            paintPattern8(bufferPos, pattern, on, off);
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        renderSpritesLineMode1(realLine, bufferPos);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG3() {                                           // Graphics 3 (Screen 4)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var lineInColor = colorTableAddress + (realLine & 0x07);
        var lineInPattern = patternTableAddress + (realLine & 0x07);
        var blockExtra = (realLine & 0xc0) << 2;                            // + 0x100 for each third block of the screen (8 pattern lines)

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;    // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++] | blockExtra;                                      // no masking needed
            var colorCode = vram[((name << 3) + lineInColor) & colorTableAddressMask];    // (8 bytes each pattern) + line inside pattern
            var pattern = vram[((name << 3) + lineInPattern) & patternTableAddressMask];
            var on =  colorPalette[colorCode >>> 4];
            var off = colorPalette[colorCode & 0xf];
            paintPattern8(bufferPos, pattern, on, off);
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        if (spritesEnabled) renderSpritesLineMode2(realLine, bufferPos, colorPaletteReal);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG4() {                                           // Graphics 4 (Screen 5)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();

        var pixelsPosBase = layoutTableAddress + (realLine << 7);
        var pixelsPos = pixelsPosBase + (leftScrollCharsInPage << 2);
        if (leftScroll2Pages && leftScrollChars < 32) pixelsPos &= modeData.evenPageMask; // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) pixelsPos = leftScroll2Pages && leftScrollChars >= 32 ? pixelsPosBase & modeData.evenPageMask : pixelsPosBase;

            var pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
        }
        bufferPos -= rightScrollPixels + 256;

        if (spritesEnabled) renderSpritesLineMode2(realLine, bufferPos, colorPaletteReal);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG5() {                                           // Graphics 5 (Screen 6)
        paintBackdrop32Tiled(bufferPosition); paintBackdrop32Tiled(bufferPosition + 512);

        var bufferPos = bufferPosition + 16 + ((horizontalAdjust + rightScrollPixels) << 1);
        var realLine = getRealLine();

        var pixelsPosBase = layoutTableAddress + (realLine << 7);
        var pixelsPos = pixelsPosBase + (leftScrollCharsInPage << 2);
        if (leftScroll2Pages && leftScrollChars < 32) pixelsPos &= modeData.evenPageMask; // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        if (color0Solid)                                                    // Normal paint for TP = 1
            for (var c = 0; c < 32; ++c) {
                if (c === scrollCharJump) pixelsPos = leftScroll2Pages && leftScrollChars >= 32 ? pixelsPosBase & modeData.evenPageMask : pixelsPosBase;

                var pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels >>> 6];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 4) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 2) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels & 0x03];
                pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels >>> 6];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 4) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 2) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels & 0x03];
                pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels >>> 6];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 4) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 2) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels & 0x03];
                pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels >>> 6];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 4) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[(pixels >>> 2) & 0x03];
                frameBackBuffer[bufferPos++] = colorPaletteSolid[pixels & 0x03];
            }
        else                                                                // Tiling for color 0 for TP = 0
            for (c = 0; c < 32; ++c) {
                if (c === scrollCharJump) pixelsPos = leftScroll2Pages && leftScrollChars >= 32 ? pixelsPosBase & modeData.evenPageMask : pixelsPosBase;

                pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = (pixels & 0xc0) ? colorPaletteSolid[pixels >>> 6] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x30) ? colorPaletteSolid[(pixels >>> 4) & 0x03] : backdropTileEven;
                frameBackBuffer[bufferPos++] = (pixels & 0x0c) ? colorPaletteSolid[(pixels >>> 2) & 0x03] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x03) ? colorPaletteSolid[pixels & 0x03] : backdropTileEven;
                pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = (pixels & 0xc0) ? colorPaletteSolid[pixels >>> 6] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x30) ? colorPaletteSolid[(pixels >>> 4) & 0x03] : backdropTileEven;
                frameBackBuffer[bufferPos++] = (pixels & 0x0c) ? colorPaletteSolid[(pixels >>> 2) & 0x03] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x03) ? colorPaletteSolid[pixels & 0x03] : backdropTileEven;
                pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = (pixels & 0xc0) ? colorPaletteSolid[pixels >>> 6] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x30) ? colorPaletteSolid[(pixels >>> 4) & 0x03] : backdropTileEven;
                frameBackBuffer[bufferPos++] = (pixels & 0x0c) ? colorPaletteSolid[(pixels >>> 2) & 0x03] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x03) ? colorPaletteSolid[pixels & 0x03] : backdropTileEven;
                pixels = vram[pixelsPos++ & layoutTableAddressMask];
                frameBackBuffer[bufferPos++] = (pixels & 0xc0) ? colorPaletteSolid[pixels >>> 6] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x30) ? colorPaletteSolid[(pixels >>> 4) & 0x03] : backdropTileEven;
                frameBackBuffer[bufferPos++] = (pixels & 0x0c) ? colorPaletteSolid[(pixels >>> 2) & 0x03] : backdropTileOdd;
                frameBackBuffer[bufferPos++] = (pixels & 0x03) ? colorPaletteSolid[pixels & 0x03] : backdropTileEven;
            }
        bufferPos -= (rightScrollPixels << 1) + 512;

        if (spritesEnabled) renderSpritesLineMode2Tiled(realLine, bufferPos);
        if (leftMask) paintBackdrop16Tiled(bufferPos);
        if (rightScrollPixels) paintBackdrop16Tiled(bufferPos + 512);

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG6() {                                           // Graphics 6 (Screen 7)
        paintBackdrop32(bufferPosition); paintBackdrop32(bufferPosition + 512);

        var bufferPos = bufferPosition + 16 + ((horizontalAdjust + rightScrollPixels) << 1);
        var realLine = getRealLine();

        var pixelsPosBase = layoutTableAddress + (realLine << 8);
        var pixelsPos = pixelsPosBase + (leftScrollCharsInPage << 3);
        if (leftScroll2Pages && leftScrollChars < 32) pixelsPos &= modeData.evenPageMask;   // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) pixelsPos = leftScroll2Pages && leftScrollChars >= 32 ? pixelsPosBase & modeData.evenPageMask : pixelsPosBase;

            var pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
            pixels = vram[pixelsPos++ & layoutTableAddressMask];
            frameBackBuffer[bufferPos++] = colorPalette[pixels >>> 4];
            frameBackBuffer[bufferPos++] = colorPalette[pixels & 0x0f];
        }
        bufferPos -= (rightScrollPixels << 1) + 512;

        if (spritesEnabled) renderSpritesLineMode2Stretched(realLine, bufferPos, colorPaletteReal);
        if (leftMask) paintBackdrop16(bufferPos);
        if (rightScrollPixels) paintBackdrop16(bufferPos + 512);

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG7() {                                           // Graphics 7 (Screen 8)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var alpha = debugModeSpriteHighlight ? DEBUG_DIM_ALPHA_MASK : 0xffffffff;

        var pixelsPosBase = layoutTableAddress + (realLine << 8);
        var pixelsPos = pixelsPosBase + (leftScrollCharsInPage << 3);
        if (leftScroll2Pages && leftScrollChars < 32) pixelsPos &= modeData.evenPageMask; // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) pixelsPos = leftScroll2Pages && leftScrollChars >= 32 ? pixelsPosBase & modeData.evenPageMask : pixelsPosBase;

            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
            frameBackBuffer[bufferPos++] = colors256[vram[pixelsPos++ & layoutTableAddressMask]] & alpha;
        }
        bufferPos -= rightScrollPixels + 256;

        if (spritesEnabled) renderSpritesLineMode2(realLine, bufferPos, spritePaletteG7);       // Special fixed palette
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeYJK() {                                          // Bitmap modes in YJK. Both horizontal resolutions (256, 512)
        paintBackdrop20(bufferPosition); paintBackdrop16(bufferPosition + 256 + 4);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels + 4;    // In YJK modes, the screen is shifted 4 pixels to the rignt
        var realLine = getRealLine();

        var pixelsPosBase = layoutTableAddress + (realLine << 8);
        var pixelsPos = pixelsPosBase + (leftScrollCharsInPage << 3);
        if (leftScroll2Pages && leftScrollChars < 32) pixelsPos &= modeData.evenPageMask; // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        var y1, y2, y3, y4, y, j, k, r, g, b;
        var alpha = 0xff000000 & (debugModeSpriteHighlight ? DEBUG_DIM_ALPHA_MASK : 0xff000000);

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) pixelsPos = leftScroll2Pages && leftScrollChars >= 32 ? pixelsPosBase & modeData.evenPageMask : pixelsPosBase;

            y1 = vram[pixelsPos++ & layoutTableAddressMask]; y2 = vram[pixelsPos++ & layoutTableAddressMask]; y3 = vram[pixelsPos++ & layoutTableAddressMask]; y4 = vram[pixelsPos++ & layoutTableAddressMask];
            j = ((y3 & 7) | ((y4 & 3) << 3)) - ((y4 & 4) << 3);
            k = ((y1 & 7) | ((y2 & 3) << 3)) - ((y2 & 4) << 3);
            y = y1 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;
            y = y2 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;
            y = y3 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;
            y = y4 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;

            y1 = vram[pixelsPos++ & layoutTableAddressMask]; y2 = vram[pixelsPos++ & layoutTableAddressMask]; y3 = vram[pixelsPos++ & layoutTableAddressMask]; y4 = vram[pixelsPos++ & layoutTableAddressMask];
            j = ((y3 & 7) | ((y4 & 3) << 3)) - ((y4 & 4) << 3);
            k = ((y1 & 7) | ((y2 & 3) << 3)) - ((y2 & 4) << 3);
            y = y1 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;
            y = y2 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;
            y = y3 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;
            y = y4 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
            frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r;
        }
        bufferPos -= rightScrollPixels + 256;

        if (spritesEnabled) renderSpritesLineMode2(realLine, bufferPos, colorPaletteReal);       // Normal palette
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeYAE() {                                          // Bitmap modes in YJK with YAE. Both horizontal resolutions (256, 512)
        paintBackdrop20(bufferPosition); paintBackdrop16(bufferPosition + 256 + 4);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels + 4;    // In YJK modes, the screen is shifted 4 pixels to the rignt
        var realLine = getRealLine();

        var pixelsPosBase = layoutTableAddress + (realLine << 8);
        var pixelsPos = pixelsPosBase + (leftScrollCharsInPage << 3);
        if (leftScroll2Pages && leftScrollChars < 32) pixelsPos &= modeData.evenPageMask; // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        var y1, y2, y3, y4, y, j, k, r, g, b;
        var alpha = 0xff000000 & (debugModeSpriteHighlight ? DEBUG_DIM_ALPHA_MASK : 0xff000000);

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) pixelsPos = leftScroll2Pages && leftScrollChars >= 32 ? pixelsPosBase & modeData.evenPageMask : pixelsPosBase;

            y1 = vram[pixelsPos++ & layoutTableAddressMask]; y2 = vram[pixelsPos++ & layoutTableAddressMask]; y3 = vram[pixelsPos++ & layoutTableAddressMask]; y4 = vram[pixelsPos++ & layoutTableAddressMask];
            j = ((y3 & 7) | ((y4 & 3) << 3)) - ((y4 & 4) << 3);
            k = ((y1 & 7) | ((y2 & 3) << 3)) - ((y2 & 4) << 3);
            if (y1 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y1 >> 4];
            else { y = y1 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }
            if (y2 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y2 >> 4];
            else { y = y2 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }
            if (y3 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y3 >> 4];
            else { y = y3 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }
            if (y4 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y4 >> 4];
            else { y = y4 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }

            y1 = vram[pixelsPos++ & layoutTableAddressMask]; y2 = vram[pixelsPos++ & layoutTableAddressMask]; y3 = vram[pixelsPos++ & layoutTableAddressMask]; y4 = vram[pixelsPos++ & layoutTableAddressMask];
            j = ((y3 & 7) | ((y4 & 3) << 3)) - ((y4 & 4) << 3);
            k = ((y1 & 7) | ((y2 & 3) << 3)) - ((y2 & 4) << 3);
            if (y1 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y1 >> 4];
            else { y = y1 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }
            if (y2 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y2 >> 4];
            else { y = y2 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }
            if (y3 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y3 >> 4];
            else { y = y3 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }
            if (y4 & 0x8) frameBackBuffer[bufferPos++] = colorPalette[y4 >> 4];
            else { y = y4 >> 3; r = from5bitsTruncTo8bits(y + j); g = from5bitsTruncTo8bits(y + k); b = from5bitsTruncTo8bits((y * 5 - (j << 1) - k) >> 2);
                frameBackBuffer[bufferPos++] = alpha | (b << 16) | (g << 8) | r; }
        }
        bufferPos -= rightScrollPixels + 256;

        if (spritesEnabled) renderSpritesLineMode2(realLine, bufferPos, colorPaletteReal);       // Normal palette
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function from5bitsTruncTo8bits(val) {
        return val <= 0 ? 0 : val >= 31 ? color5to8bits[31] : color5to8bits[val];
    }

    function renderLineModeT1PatInfo() {                                // Text (Screen 0)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var lineInPattern = realLine & 0x07;

        var namePos = layoutTableAddress + ((realLine >>> 3) * 40);

        paintBackdrop8(bufferPos); bufferPos += 8;                          // Text padding
        for (var c = 0; c < 40; ++c) {
            var name = vram[namePos++];
            if (debugModePatternInfoNames) {
                var on =  name === 0 || name === 0x20 ? 0xffee0000 : 0xffffffff;
                var pattern = vram[DEBUG_PAT_DIGI6_TABLE_ADDRESS + (name << 3) + lineInPattern];
                paintPattern6TInfo(bufferPos, pattern, on, 0xff000000);
            } else {
                pattern = vram[patternTableAddress + (name << 3) + lineInPattern];
                paintPattern6(bufferPos, pattern, 0xffffffff, 0xff000000);
            }
            bufferPos += 6;
        }
        paintBackdrop8(bufferPos); bufferPos += 8;                          // Text padding
        bufferPos -= rightScrollPixels + 256;

        // Sprites deactivated
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeT2PatInfo() {                                // Text (Screen 0 width 80)
        paintBackdrop32(bufferPosition); paintBackdrop32(bufferPosition + 512);

        var bufferPos = bufferPosition + 16 + ((horizontalAdjust + rightScrollPixels) << 1);
        var realLine = getRealLine();
        var lineInPattern = realLine & 0x07;
        var name, pattern, on;

        var namePos = layoutTableAddress + (realLine >>> 3) * 80;

        paintBackdrop16(bufferPos); bufferPos += 16;                        // Text padding
        if (blinkEvenPage) {                                                // Blink only in Even page
            var blinkPos = colorTableAddress + (realLine >>> 3) * 10;
            var blinkBit = 7;
            for (var c = 0; c < 80; ++c) {
                var blink = (vram[blinkPos & colorTableAddressMask] >>> blinkBit) & 1;
                name = vram[namePos++ & layoutTableAddressMask];
                if (debugModePatternInfoNames) {
                    on = name === 0 || name === 0x20 ? 0xffee0000 : 0xffffffff;
                    if (blink) on &= 0xffa0a0a0;
                    pattern = vram[DEBUG_PAT_DIGI6_TABLE_ADDRESS + (name << 3) + lineInPattern];
                    paintPattern6TInfo(bufferPos, pattern, on, 0xff000000);
                } else {
                    pattern = vram[patternTableAddress + (name << 3) + lineInPattern];      // no masking needed
                    paintPattern6(bufferPos, pattern, blink ? 0xffa0a0a0 : 0xffffffff, 0xff000000);
                }
                if (--blinkBit < 0) { blinkPos++; blinkBit = 7; }
                bufferPos += 6;
            }
        } else {
            for (c = 0; c < 80; ++c) {
                name = vram[namePos++ & layoutTableAddressMask];
                if (debugModePatternInfoNames) {
                    on = name === 0 || name === 0x20 ? 0xffee0000 : 0xffffffff;
                    pattern = vram[DEBUG_PAT_DIGI6_TABLE_ADDRESS + (name << 3) + lineInPattern];
                    paintPattern6TInfo(bufferPos, pattern, on, 0xff000000);
                } else {
                    pattern = vram[patternTableAddress + (name << 3) + lineInPattern];      // no masking needed
                    paintPattern6(bufferPos, pattern, 0xffffffff, 0xff000000);
                }
                bufferPos += 6;
            }
        }
        paintBackdrop16(bufferPos); bufferPos += 16;                        // Text padding
        bufferPos -= (rightScrollPixels << 1) + 512;

        // Sprites deactivated
        if (leftMask) paintBackdrop16(bufferPos); // { paintPattern8(bufferPos, 255, 0xff0000ff, 0); paintPattern8(bufferPos + 8, 255, 0xff0000ff, 0); }
        if (rightScrollPixels) paintBackdrop16(bufferPos + 512); // { paintPattern8(bufferPos + 512, 255, 0xff0000ff, 0); paintPattern8(bufferPos + 512 + 8, 255, 0xff0000ff, 0); }

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function paintPattern6TInfo(bufferPos, pattern, on, off) {
        var low = on & 0x97ffffff;
        frameBackBuffer[bufferPos]     = pattern & 0x80 ? on : off; frameBackBuffer[bufferPos + 1] = pattern & 0x40 ? on : off; frameBackBuffer[bufferPos + 2] = pattern & 0x20 ? on : off;
        frameBackBuffer[bufferPos + 3] = pattern & 0x10 ? low : off;  frameBackBuffer[bufferPos + 4] = pattern & 0x08 ? low : off;  frameBackBuffer[bufferPos + 5] = pattern & 0x04 ? low : off;
    }

    function renderLineModeMCPatInfo() {                                // Multicolor (Screen 3)
        if (!debugModePatternInfoNames) return renderLineModeMC();

        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;    // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++];
            var pattern = vram[DEBUG_PAT_DIGI8_TABLE_ADDRESS + (name << 3) + (realLine & 0x07)];
            paintPattern8(bufferPos, pattern, 0xffffffff, 0xff000000);
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        renderSpritesLineMode1(realLine, bufferPos);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG1PatInfo() {                                // Graphics 1 (Screen 1)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var lineInPattern = realLine & 0x07;
        var pattern, on, off;

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;    // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++];
            if (debugModePatternInfoNames) {
                on =  name === 0 || name === 0x20 ? 0xffee0000 : 0xffffffff;
                off = 0xff000000;
                pattern = vram[DEBUG_PAT_DIGI8_TABLE_ADDRESS + (name << 3) + lineInPattern];
            } else if (debugModePatternInfoBlocks) {
                var colorCode = vram[colorTableAddress + (name >>> 3)];
                on =  colorPalette[colorCode >>> 4];
                off = colorPalette[colorCode & 0xf];
                pattern = vram[DEBUG_PAT_BLOCK_TABLE_ADDRESS + lineInPattern];
            } else {
                on =  0xffffffff;
                off = 0xff000000;
                pattern = vram[patternTableAddress + (name << 3) + lineInPattern];
            }
            paintPattern8(bufferPos, pattern, on, off);
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        renderSpritesLineMode1(realLine, bufferPos);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG2PatInfo() {                                // Graphics 2 (Screen 2)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var lineInPattern = realLine & 0x07;
        var blockExtra = (realLine & 0xc0) << 2;
        var pattern, on, off;

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;     // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++] | blockExtra;
            if (debugModePatternInfoNames) {
                name &= 0xff;
                on =  name === 0 || name === 0x20 ? 0xffee0000 : 0xffffffff;
                off = 0xff000000;
                pattern = vram[DEBUG_PAT_DIGI8_TABLE_ADDRESS + (name << 3) + lineInPattern];
            } else if (debugModePatternInfoBlocks) {
                var colorCode = vram[(colorTableAddress + (name << 3) + lineInPattern) & colorTableAddressMask];
                on =  colorPalette[colorCode >>> 4];
                off = colorPalette[colorCode & 0xf];
                pattern = vram[DEBUG_PAT_BLOCK_TABLE_ADDRESS + lineInPattern];
            } else {
                on =  0xffffffff;
                off = 0xff000000;
                pattern = vram[(patternTableAddress + (name << 3) + lineInPattern) & patternTableAddressMask];
            }
            paintPattern8(bufferPos, pattern, on, off);
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        renderSpritesLineMode1(realLine, bufferPos);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function renderLineModeG3PatInfo() {                                // Graphics 3 (Screen 4)
        paintBackdrop16(bufferPosition); paintBackdrop16(bufferPosition + 256);

        var bufferPos = bufferPosition + 8 + horizontalAdjust + rightScrollPixels;
        var realLine = getRealLine();
        var lineInPattern = realLine & 0x07;
        var blockExtra = (realLine & 0xc0) << 2;
        var pattern, on, off;

        var namePosBase = layoutTableAddress + ((realLine >>> 3) << 5);
        var namePos = namePosBase + leftScrollCharsInPage;
        if (leftScroll2Pages && leftScrollChars < 32) namePos &= modeData.evenPageMask;    // Start at even page
        var scrollCharJump = leftScrollCharsInPage ? 32 - leftScrollCharsInPage : -1;

        for (var c = 0; c < 32; ++c) {
            if (c === scrollCharJump) namePos = leftScroll2Pages && leftScrollChars >= 32 ? namePosBase & modeData.evenPageMask : namePosBase;
            var name = vram[namePos++] | blockExtra;
            if (debugModePatternInfoNames) {
                name &= 0xff;
                on =  name === 0 || name === 0x20 ? 0xffee0000 : 0xffffffff;
                off = 0xff000000;
                pattern = vram[DEBUG_PAT_DIGI8_TABLE_ADDRESS + (name << 3) + lineInPattern];
            } else if (debugModePatternInfoBlocks) {
                var colorCode = vram[(colorTableAddress + (name << 3) + lineInPattern) & colorTableAddressMask];
                on =  colorPalette[colorCode >>> 4];
                off = colorPalette[colorCode & 0xf];
                pattern = vram[DEBUG_PAT_BLOCK_TABLE_ADDRESS + lineInPattern];
            } else {
                on =  0xffffffff;
                off = 0xff000000;
                pattern = vram[(patternTableAddress + (name << 3) + lineInPattern) & patternTableAddressMask];
            }
            paintPattern8(bufferPos, pattern, on, off);
            bufferPos += 8;
        }
        bufferPos -= rightScrollPixels + 256;

        if (spritesEnabled) renderSpritesLineMode2(realLine, bufferPos, colorPaletteReal);
        if (leftMask) paintBackdrop8(bufferPos);
        if (rightScrollPixels) paintBackdrop8(bufferPos + 256);

        if (renderWidth > 500) stretchCurrentLine();

        bufferPosition = bufferPosition + bufferLineAdvance;
    }

    function paintPattern6(bufferPos, pattern, on, off) {
        frameBackBuffer[bufferPos]     = pattern & 0x80 ? on : off; frameBackBuffer[bufferPos + 1] = pattern & 0x40 ? on : off; frameBackBuffer[bufferPos + 2] = pattern & 0x20 ? on : off;
        frameBackBuffer[bufferPos + 3] = pattern & 0x10 ? on : off; frameBackBuffer[bufferPos + 4] = pattern & 0x08 ? on : off; frameBackBuffer[bufferPos + 5] = pattern & 0x04 ? on : off;
    }

    function paintPattern8(bufferPos, pattern, on, off) {
        frameBackBuffer[bufferPos]     = pattern & 0x80 ? on : off; frameBackBuffer[bufferPos + 1] = pattern & 0x40 ? on : off; frameBackBuffer[bufferPos + 2] = pattern & 0x20 ? on : off; frameBackBuffer[bufferPos + 3] = pattern & 0x10 ? on : off;
        frameBackBuffer[bufferPos + 4] = pattern & 0x08 ? on : off; frameBackBuffer[bufferPos + 5] = pattern & 0x04 ? on : off; frameBackBuffer[bufferPos + 6] = pattern & 0x02 ? on : off; frameBackBuffer[bufferPos + 7] = pattern & 0x01 ? on : off;
    }

    function paintBackdrop8(bufferPos) {
        frameBackBuffer[bufferPos]      = backdropValue; frameBackBuffer[bufferPos +  1] = backdropValue; frameBackBuffer[bufferPos +  2] = backdropValue; frameBackBuffer[bufferPos +  3] = backdropValue;
        frameBackBuffer[bufferPos +  4] = backdropValue; frameBackBuffer[bufferPos +  5] = backdropValue; frameBackBuffer[bufferPos +  6] = backdropValue; frameBackBuffer[bufferPos +  7] = backdropValue;
    }

    function paintBackdrop16(bufferPos) {
        frameBackBuffer[bufferPos]      = backdropValue; frameBackBuffer[bufferPos +  1] = backdropValue; frameBackBuffer[bufferPos +  2] = backdropValue; frameBackBuffer[bufferPos +  3] = backdropValue;
        frameBackBuffer[bufferPos +  4] = backdropValue; frameBackBuffer[bufferPos +  5] = backdropValue; frameBackBuffer[bufferPos +  6] = backdropValue; frameBackBuffer[bufferPos +  7] = backdropValue;
        frameBackBuffer[bufferPos +  8] = backdropValue; frameBackBuffer[bufferPos +  9] = backdropValue; frameBackBuffer[bufferPos + 10] = backdropValue; frameBackBuffer[bufferPos + 11] = backdropValue;
        frameBackBuffer[bufferPos + 12] = backdropValue; frameBackBuffer[bufferPos + 13] = backdropValue; frameBackBuffer[bufferPos + 14] = backdropValue; frameBackBuffer[bufferPos + 15] = backdropValue;
    }

    function paintBackdrop20(bufferPos) {
        frameBackBuffer[bufferPos]      = backdropValue; frameBackBuffer[bufferPos +  1] = backdropValue; frameBackBuffer[bufferPos +  2] = backdropValue; frameBackBuffer[bufferPos +  3] = backdropValue;
        frameBackBuffer[bufferPos +  4] = backdropValue; frameBackBuffer[bufferPos +  5] = backdropValue; frameBackBuffer[bufferPos +  6] = backdropValue; frameBackBuffer[bufferPos +  7] = backdropValue;
        frameBackBuffer[bufferPos +  8] = backdropValue; frameBackBuffer[bufferPos +  9] = backdropValue; frameBackBuffer[bufferPos + 10] = backdropValue; frameBackBuffer[bufferPos + 11] = backdropValue;
        frameBackBuffer[bufferPos + 12] = backdropValue; frameBackBuffer[bufferPos + 13] = backdropValue; frameBackBuffer[bufferPos + 14] = backdropValue; frameBackBuffer[bufferPos + 15] = backdropValue;
        frameBackBuffer[bufferPos + 16] = backdropValue; frameBackBuffer[bufferPos + 17] = backdropValue; frameBackBuffer[bufferPos + 18] = backdropValue; frameBackBuffer[bufferPos + 19] = backdropValue;
    }

    function paintBackdrop32(bufferPos) {
        frameBackBuffer[bufferPos]      = backdropValue; frameBackBuffer[bufferPos +  1] = backdropValue; frameBackBuffer[bufferPos +  2] = backdropValue; frameBackBuffer[bufferPos +  3] = backdropValue;
        frameBackBuffer[bufferPos +  4] = backdropValue; frameBackBuffer[bufferPos +  5] = backdropValue; frameBackBuffer[bufferPos +  6] = backdropValue; frameBackBuffer[bufferPos +  7] = backdropValue;
        frameBackBuffer[bufferPos +  8] = backdropValue; frameBackBuffer[bufferPos +  9] = backdropValue; frameBackBuffer[bufferPos + 10] = backdropValue; frameBackBuffer[bufferPos + 11] = backdropValue;
        frameBackBuffer[bufferPos + 12] = backdropValue; frameBackBuffer[bufferPos + 13] = backdropValue; frameBackBuffer[bufferPos + 14] = backdropValue; frameBackBuffer[bufferPos + 15] = backdropValue;
        frameBackBuffer[bufferPos + 16] = backdropValue; frameBackBuffer[bufferPos + 17] = backdropValue; frameBackBuffer[bufferPos + 18] = backdropValue; frameBackBuffer[bufferPos + 19] = backdropValue;
        frameBackBuffer[bufferPos + 20] = backdropValue; frameBackBuffer[bufferPos + 21] = backdropValue; frameBackBuffer[bufferPos + 22] = backdropValue; frameBackBuffer[bufferPos + 23] = backdropValue;
        frameBackBuffer[bufferPos + 24] = backdropValue; frameBackBuffer[bufferPos + 25] = backdropValue; frameBackBuffer[bufferPos + 26] = backdropValue; frameBackBuffer[bufferPos + 27] = backdropValue;
        frameBackBuffer[bufferPos + 28] = backdropValue; frameBackBuffer[bufferPos + 29] = backdropValue; frameBackBuffer[bufferPos + 30] = backdropValue; frameBackBuffer[bufferPos + 31] = backdropValue;
    }

    function paintBackdrop16Tiled(bufferPos) {
        var odd = backdropTileOdd; var even = backdropTileEven;
        frameBackBuffer[bufferPos]      = odd; frameBackBuffer[bufferPos +  1] = even; frameBackBuffer[bufferPos +  2] = odd; frameBackBuffer[bufferPos +  3] = even;
        frameBackBuffer[bufferPos +  4] = odd; frameBackBuffer[bufferPos +  5] = even; frameBackBuffer[bufferPos +  6] = odd; frameBackBuffer[bufferPos +  7] = even;
        frameBackBuffer[bufferPos +  8] = odd; frameBackBuffer[bufferPos +  9] = even; frameBackBuffer[bufferPos + 10] = odd; frameBackBuffer[bufferPos + 11] = even;
        frameBackBuffer[bufferPos + 12] = odd; frameBackBuffer[bufferPos + 13] = even; frameBackBuffer[bufferPos + 14] = odd; frameBackBuffer[bufferPos + 15] = even;
    }

    function paintBackdrop32Tiled(bufferPos) {
        var odd = backdropTileOdd; var even = backdropTileEven;
        frameBackBuffer[bufferPos]      = odd; frameBackBuffer[bufferPos +  1] = even; frameBackBuffer[bufferPos +  2] = odd; frameBackBuffer[bufferPos +  3] = even;
        frameBackBuffer[bufferPos +  4] = odd; frameBackBuffer[bufferPos +  5] = even; frameBackBuffer[bufferPos +  6] = odd; frameBackBuffer[bufferPos +  7] = even;
        frameBackBuffer[bufferPos +  8] = odd; frameBackBuffer[bufferPos +  9] = even; frameBackBuffer[bufferPos + 10] = odd; frameBackBuffer[bufferPos + 11] = even;
        frameBackBuffer[bufferPos + 12] = odd; frameBackBuffer[bufferPos + 13] = even; frameBackBuffer[bufferPos + 14] = odd; frameBackBuffer[bufferPos + 15] = even;
        frameBackBuffer[bufferPos + 16] = odd; frameBackBuffer[bufferPos + 17] = even; frameBackBuffer[bufferPos + 18] = odd; frameBackBuffer[bufferPos + 19] = even;
        frameBackBuffer[bufferPos + 20] = odd; frameBackBuffer[bufferPos + 21] = even; frameBackBuffer[bufferPos + 22] = odd; frameBackBuffer[bufferPos + 23] = even;
        frameBackBuffer[bufferPos + 24] = odd; frameBackBuffer[bufferPos + 25] = even; frameBackBuffer[bufferPos + 26] = odd; frameBackBuffer[bufferPos + 27] = even;
        frameBackBuffer[bufferPos + 28] = odd; frameBackBuffer[bufferPos + 29] = even; frameBackBuffer[bufferPos + 30] = odd; frameBackBuffer[bufferPos + 31] = even;
    }

    function renderSpritesLineMode1(line, bufferPos) {
        if (debugModeSpritesHidden || vram[spriteAttrTableAddress] === 208) return;    // No sprites to show!

        var size = spritesSize << spritesMag;
        var atrPos, color, name, lineInPattern, pattern;
        var sprite = -1, drawn = 0, y, spriteLine, x, s, f;
        spritesGlobalPriority -= 32;

        atrPos = spriteAttrTableAddress - 4;
        for (var i = 0; i < 32; i = i + 1) {                                // Max of 32 sprites
            atrPos = atrPos + 4;
            sprite = sprite + 1;
            y = vram[atrPos];
            if (y === 208) break;                                           // Stop Sprite processing for the line, as per spec
            spriteLine = (line - y - 1) & 255;
            if (spriteLine >= size) continue;                               // Not visible at line
            if (++drawn > 4) {                                              // Max of 4 sprites drawn. Store the first invalid (5th)
                if (spritesInvalid < 0 && !verticalIntReached) spritesInvalid = sprite;
                if (spriteDebugModeLimit) return;
            }
            x = vram[atrPos + 1];
            color = vram[atrPos + 3];
            if (color & 0x80) {
                x -= 32;                                                    // Early Clock bit, X to be 32 to the left
                if (x <= -size) continue;                                   // Not visible (out to the left)
            }
            color &= 0x0f;
            if (spritesSize === 16) {
                name = debugModeSpriteInfoNumbers ? sprite << 2: vram[atrPos + 2] & 0xfc;
                lineInPattern = spritePatternTableAddress + (name << 3) + (spriteLine >>> spritesMag);
                pattern = (vram[lineInPattern] << 8) | vram[lineInPattern + 16];
            } else {
                name = debugModeSpriteInfoNumbers ? sprite : vram[atrPos + 2];
                pattern = vram[spritePatternTableAddress + (name << 3) + (spriteLine >>> spritesMag)];
            }
            s = x <= 256 - size ? 0 : x - (256 - size);
            f = x >= 0 ? size : size + x;
            x += (size - f);
            paintSpriteMode1(x, line, bufferPos + x, spritesGlobalPriority + sprite, pattern, color, s, f, spritesMag, spriteDebugModeCollisions && (drawn < 5));
        }
        if (spritesInvalid < 0 && sprite > spritesMaxComputed) spritesMaxComputed = sprite;
    }

    function paintSpriteMode1(x, y, bufferPos, spritePri, pattern, color, start, finish, magShift, collide) {
        for (var i = finish - 1; i >= start; i = i - 1, x = x + 1, bufferPos = bufferPos + 1) {
            var s = (pattern >>> (i >>> magShift)) & 0x01;
            if (s === 0) continue;
            if (spritesLinePriorities[x] < spritePri) {                                     // Higher priority sprite already there
                if (collide && !spritesCollided) setSpritesCollision(x, y);
                if (color !== 0 && spritesLineColors[x] === 0) {                            // Paint only if not transparent and higher priority was transparent
                    spritesLineColors[x] = color;                                           // Register new color
                    frameBackBuffer[bufferPos] = colorPaletteReal[color];
                }
            } else {                                                                        // No higher priority there
                spritesLinePriorities[x] = spritePri;                                       // Register new priority
                spritesLineColors[x] = color;                                               // Register new color
                if (color !== 0) frameBackBuffer[bufferPos] = colorPaletteReal[color];      // Paint only if not transparent
            }
        }
    }

    function renderSpritesLineMode2(line, bufferPos, palette) {
        if (vram[spriteAttrTableAddress + 512] === 216) return;             // No sprites to show!

        var size = spritesSize << spritesMag;
        var atrPos, colorPos, color, name, lineInPattern, pattern;
        var sprite = -1, spritePri = SPRITE_MAX_PRIORITY, drawn = 0, y, spriteLine, x, s, f, cc;
        spritesGlobalPriority -= 32;

        atrPos = spriteAttrTableAddress + 512 - 4;
        colorPos = spriteAttrTableAddress - 16;
        for (var i = 0; i < 32; i = i + 1) {                                // Max of 32 sprites
            sprite = sprite + 1;
            atrPos = atrPos + 4;
            colorPos = colorPos + 16;
            y = vram[atrPos];
            if (y === 216) break;                                           // Stop Sprite processing for the line, as per spec
            spriteLine = (line - y - 1) & 255;
            if (spriteLine >= size) continue;                               // Not visible at line
            if (++drawn > 8) {                                              // Max of 8 sprites drawn. Store the first invalid (9th)
                if (spritesInvalid < 0 && !verticalIntReached) spritesInvalid = sprite;
                if (spriteDebugModeLimit) return;
            }
            spriteLine >>>= spritesMag;                                     // Adjust for Mag
            color = vram[colorPos + spriteLine];
            cc = color & 0x40;
            if (cc) {
                if (spritePri === SPRITE_MAX_PRIORITY || debugModeSpriteInfo) continue;   // Must have a higher priority Main Sprite (CC = 0) to show this one and not showing info
            } else spritePri = spritesGlobalPriority + sprite;
            if ((color & 0xf) === 0 && !color0Solid) continue;              // Nothing to paint. Consider TP
            x = vram[atrPos + 1];
            if (color & 0x80) {
                x -= 32;                                                    // Early Clock bit, X to be 32 to the left
                if (x <= -size) continue;                                   // Not visible (out to the left)
            }
            if (spritesSize === 16) {
                name = debugModeSpriteInfoNumbers ? sprite << 2: vram[atrPos + 2] & 0xfc;
                lineInPattern = spritePatternTableAddress + (name << 3) + spriteLine;
                pattern = (vram[lineInPattern] << 8) | vram[lineInPattern + 16];
            } else {
                name = debugModeSpriteInfoNumbers ? sprite : vram[atrPos + 2];
                pattern = vram[spritePatternTableAddress + (name << 3) + spriteLine];
            }
            s = x <= 256 - size ? 0 : x - (256 - size);
            f = x >= 0 ? size : size + x;
            x += (size - f);
            if (cc) paintSpriteMode2CC (x, bufferPos + x, spritePri, pattern, color & 0xf, palette, s, f, spritesMag);
            else paintSpriteMode2(x, line, bufferPos + x, spritePri, pattern, color & 0xf, palette, s, f, spritesMag, spriteDebugModeCollisions && ((color & 0x20) === 0) && (drawn < 9));       // Consider IC
        }
        if (spritesInvalid < 0 && sprite > spritesMaxComputed) spritesMaxComputed = sprite;
    }

    function paintSpriteMode2(x, y, bufferPos, spritePri, pattern, color, palette, start, finish, magShift, collide) {
        for (var i = finish - 1; i >= start; i = i - 1, x = x + 1, bufferPos = bufferPos + 1) {
            var s = (pattern >>> (i >>> magShift)) & 0x01;
            if (s === 0) continue;
            if (spritesLinePriorities[x] < spritePri) {                                     // Higher priority sprite already there
                if (collide && !spritesCollided) setSpritesCollision(x, y);
                continue;
            }
            spritesLinePriorities[x] = spritePri;                                           // Register new priority
            spritesLineColors[x] = color;                                                   // Register new color
            frameBackBuffer[bufferPos] = palette[color];
        }
    }

    function paintSpriteMode2CC(x, bufferPos, spritePri, pattern, color, palette, start, finish, magShift) {
        var finalColor;
        for (var i = finish - 1; i >= start; i = i - 1, x = x + 1, bufferPos = bufferPos + 1) {
            var s = (pattern >>> (i >>> magShift)) & 0x01;
            if (s === 0) continue;
            var prevSpritePri = spritesLinePriorities[x];
            if (prevSpritePri < spritePri) continue;                                        // Higher priority sprite already there
            if (prevSpritePri === spritePri)
                finalColor = color | spritesLineColors[x];                                  // Mix if same priority
            else {
                spritesLinePriorities[x] = spritePri;                                       // Otherwise register new priority
                finalColor = color;
            }
            spritesLineColors[x] = finalColor;                                              // Register new color
            frameBackBuffer[bufferPos] = palette[finalColor];
        }
    }

    function renderSpritesLineMode2Tiled(line, bufferPos) {
        if (vram[spriteAttrTableAddress + 512] === 216) return;             // No sprites to show!

        var size = spritesSize << spritesMag;
        var atrPos, colorPos, color, name, lineInPattern, pattern;
        var sprite = -1, spritePri = SPRITE_MAX_PRIORITY, drawn = 0, y, spriteLine, x, s, f, cc;
        spritesGlobalPriority -= 32;

        atrPos = spriteAttrTableAddress + 512 - 4;
        colorPos = spriteAttrTableAddress - 16;
        for (var i = 0; i < 32; i = i + 1) {                                // Max of 32 sprites
            sprite = sprite + 1;
            atrPos = atrPos + 4;
            colorPos = colorPos + 16;
            y = vram[atrPos];
            if (y === 216) break;                                           // Stop Sprite processing for the line, as per spec
            spriteLine = (line - y - 1) & 255;
            if (spriteLine >= size) continue;                               // Not visible at line
            if (++drawn > 8) {                                              // Max of 8 sprites drawn. Store the first invalid (9th)
                if (spritesInvalid < 0 && !verticalIntReached) spritesInvalid = sprite;
                if (spriteDebugModeLimit) return;
            }
            spriteLine >>>= spritesMag;                                     // Adjust for Mag
            color = vram[colorPos + spriteLine];
            cc = color & 0x40;
            if (cc) {
                if (spritePri === SPRITE_MAX_PRIORITY || debugModeSpriteInfo) continue;   // Must have a higher priority Main Sprite (CC = 0) to show this one and not showing info
            } else spritePri = spritesGlobalPriority + sprite;
            if ((color & 0xf) === 0 && !color0Solid) continue;              // Nothing to paint. Consider TP
            x = vram[atrPos + 1];
            if (color & 0x80) {
                x -= 32;                                                    // Early Clock bit, X to be 32 to the left
                if (x <= -size) continue;                                   // Not visible (out to the left)
            }
            if (spritesSize === 16) {
                name = debugModeSpriteInfoNumbers ? sprite << 2 : vram[atrPos + 2] & 0xfc;
                lineInPattern = spritePatternTableAddress + (name << 3) + spriteLine;
                pattern = (vram[lineInPattern] << 8) | vram[lineInPattern + 16];
            } else {
                name = debugModeSpriteInfoNumbers ? sprite : vram[atrPos + 2];
                pattern = vram[spritePatternTableAddress + (name << 3) + spriteLine];
            }
            s = x <= 256 - size ? 0 : x - (256 - size);
            f = x >= 0 ? size : size + x;
            x += (size - f);
            if (cc) paintSpriteMode2TiledCC(x, bufferPos + (x << 1), spritePri, pattern, color & 0xf, s, f, spritesMag);
            else paintSpriteMode2Tiled(x, line, bufferPos + (x << 1), spritePri, pattern, color & 0xf, s, f, spritesMag, spriteDebugModeCollisions && ((color & 0x20) === 0) && (drawn < 9));       // Consider IC
        }
        if (spritesInvalid < 0 && sprite > spritesMaxComputed) spritesMaxComputed = sprite;
    }

    function paintSpriteMode2Tiled(x, y, bufferPos, spritePri, pattern, color, start, finish, magShift, collide) {
        for (var i = finish - 1; i >= start; i = i - 1, x = x + 1, bufferPos = bufferPos + 2) {
            var s = (pattern >>> (i >>> magShift)) & 0x01;
            if (s === 0) continue;
            if (spritesLinePriorities[x] < spritePri) {                                     // Higher priority sprite already there
                if (collide && !spritesCollided) setSpritesCollision(x, y);
                continue;
            }
            spritesLinePriorities[x] = spritePri;                                           // Register new priority
            spritesLineColors[x] = color;                                                   // Register new color
            frameBackBuffer[bufferPos] = colorPaletteReal[color >>> 2];
            frameBackBuffer[bufferPos + 1] = colorPaletteReal[color & 0x03];
        }
    }

    function paintSpriteMode2TiledCC(x, bufferPos, spritePri, pattern, color, start, finish, magShift) {
        var finalColor;
        for (var i = finish - 1; i >= start; i = i - 1, x = x + 1, bufferPos = bufferPos + 2) {
            var s = (pattern >>> (i >>> magShift)) & 0x01;
            if (s === 0) continue;
            var prevSpritePri = spritesLinePriorities[x];
            if (prevSpritePri < spritePri) continue;                                        // Higher priority sprite already there
            if (prevSpritePri === spritePri)
                finalColor = color | spritesLineColors[x];                                  // Mix if same priority
            else {
                spritesLinePriorities[x] = spritePri;                                       // Otherwise register new priority
                finalColor = color;
            }
            spritesLineColors[x] = finalColor;                                              // Register new color
            frameBackBuffer[bufferPos] = colorPaletteReal[finalColor >>> 2];
            frameBackBuffer[bufferPos + 1] = colorPaletteReal[finalColor & 0x03];
        }
    }

    function renderSpritesLineMode2Stretched(line, bufferPos) {
        if (vram[spriteAttrTableAddress + 512] === 216) return;             // No sprites to show!

        var size = spritesSize << spritesMag;
        var atrPos, colorPos, color, name, lineInPattern, pattern;
        var sprite = -1, spritePri = SPRITE_MAX_PRIORITY, drawn = 0, y, spriteLine, x, s, f, cc;
        spritesGlobalPriority -= 32;

        atrPos = spriteAttrTableAddress + 512 - 4;
        colorPos = spriteAttrTableAddress - 16;
        for (var i = 0; i < 32; i = i + 1) {                                // Max of 32 sprites
            sprite = sprite + 1;
            atrPos = atrPos + 4;
            colorPos = colorPos + 16;
            y = vram[atrPos];
            if (y === 216) break;                                           // Stop Sprite processing for the line, as per spec
            spriteLine = (line - y - 1) & 255;
            if (spriteLine >= size) continue;                               // Not visible at line
            if (++drawn > 8) {                                              // Max of 8 sprites drawn. Store the first invalid (9th)
                if (spritesInvalid < 0 && !verticalIntReached) spritesInvalid = sprite;
                if (spriteDebugModeLimit) return;
            }
            spriteLine >>>= spritesMag;                                     // Adjust for Mag
            color = vram[colorPos + spriteLine];
            cc = color & 0x40;
            if (cc) {
                if (spritePri === SPRITE_MAX_PRIORITY || debugModeSpriteInfo) continue;   // Must have a higher priority Main Sprite (CC = 0) to show this one and not showing info
            } else spritePri = spritesGlobalPriority + sprite;
            if ((color & 0xf) === 0 && !color0Solid) continue;              // Nothing to paint. Consider TP
            x = vram[atrPos + 1];
            if (color & 0x80) {
                x -= 32;                                                    // Early Clock bit, X to be 32 to the left
                if (x <= -size) continue;                                   // Not visible (out to the left)
            }
            if (spritesSize === 16) {
                name = debugModeSpriteInfoNumbers ? sprite << 2: vram[atrPos + 2] & 0xfc;
                lineInPattern = spritePatternTableAddress + (name << 3) + spriteLine;
                pattern = (vram[lineInPattern] << 8) | vram[lineInPattern + 16];
            } else {
                name = debugModeSpriteInfoNumbers ? sprite : vram[atrPos + 2];
                pattern = vram[spritePatternTableAddress + (name << 3) + spriteLine];
            }
            s = x <= 256 - size ? 0 : x - (256 - size);
            f = x >= 0 ? size : size + x;
            x += (size - f);
            if (cc) paintSpriteMode2StretchedCC(x, bufferPos + (x << 1), spritePri, pattern, color & 0xf, s, f, spritesMag);
            else paintSpriteMode2Stretched(x, line, bufferPos + (x << 1), spritePri, pattern, color & 0xf, s, f, spritesMag, spriteDebugModeCollisions && ((color & 0x20) === 0) && (drawn < 9));       // Consider IC
        }
        if (spritesInvalid < 0 && sprite > spritesMaxComputed) spritesMaxComputed = sprite;
    }

    function paintSpriteMode2Stretched(x, y, bufferPos, spritePri, pattern, color, start, finish, magShift, collide) {
        for (var i = finish - 1; i >= start; i = i - 1, x = x + 1, bufferPos = bufferPos + 2) {
            var s = (pattern >>> (i >>> magShift)) & 0x01;
            if (s === 0) continue;
            if (spritesLinePriorities[x] < spritePri) {                                     // Higher priority sprite already there
                if (collide && !spritesCollided) setSpritesCollision(x, y);
                continue;
            }
            spritesLinePriorities[x] = spritePri;                                           // Register new priority
            spritesLineColors[x] = color;                                                   // Register new color
            frameBackBuffer[bufferPos] = frameBackBuffer[bufferPos + 1] = colorPaletteReal[color];
        }
    }

    function paintSpriteMode2StretchedCC(x, bufferPos, spritePri, pattern, color, start, finish, magShift) {
        var finalColor;
        for (var i = finish - 1; i >= start; i = i - 1, x = x + 1, bufferPos = bufferPos + 2) {
            var s = (pattern >>> (i >>> magShift)) & 0x01;
            if (s === 0) continue;
            var prevSpritePri = spritesLinePriorities[x];
            if (prevSpritePri < spritePri) continue;                                        // Higher priority sprite already there
            if (prevSpritePri === spritePri)
                finalColor = color | spritesLineColors[x];                                  // Mix if same priority
            else {
                spritesLinePriorities[x] = spritePri;                                       // Otherwise register new priority
                finalColor = color;
            }
            spritesLineColors[x] = finalColor;                                              // Register new color
            frameBackBuffer[bufferPos] = frameBackBuffer[bufferPos + 1] = colorPaletteReal[finalColor];
        }
    }

    function setSpritesCollision(x, y) {
        spritesCollided = true;
        if (spritesCollisionX >= 0) return;                             // Only set if clear
        spritesCollisionX = x + 12; spritesCollisionY = y + 8;          // Additions as per spec
        if ((register[8] & 0xc0) === 0) {                               // Only report if Mouse (MS) and LightPen (LP) are disabled
            oldStatus[3] = spritesCollisionX & 255;
            oldStatus[4] = 0xfe | (spritesCollisionX >>> 8);
            oldStatus[5] = spritesCollisionY & 255;
            oldStatus[6] = 0xfc | (spritesCollisionY >>> 8);
        }
    }

    function stretchCurrentLine() {
        var end = 256 + 8*2;
        var s = bufferPosition + end - 1, d = bufferPosition + (end << 1) - 2;
        for (var i = end; i > 0; --i, --s, d = d - 2)
            frameBackBuffer[d] = frameBackBuffer[d + 1] = frameBackBuffer[s];

        //logInfo("Stretch currentLine");
    }

    function stretchFromCurrentToTopScanline() {
        var end = 256 + 8*2;
        var pos = bufferPosition;
        for (var line = currentScanline; line >= startingVisibleTopBorderScanline; --line, pos -= bufferLineAdvance) {
            var s = pos + end - 1, d = pos + (end << 1) - 2;
            for (var i = end; i > 0; --i, --s, d = d - 2)
                frameBackBuffer[d] = frameBackBuffer[d + 1] = frameBackBuffer[s];
        }

        //logInfo("Stretch to top");
    }

    function cleanFrameBuffer() {
        // wmsx.Util.arrayFill(frameBackBuffer, backdropValue);
        frameBackBuffer.fill(0xffe030e0);

        //logInfo("Clear Buffer");
    }

    function refresh() {
        // Send frame to monitor
        videoSignal.newFrame(frameCanvas, refreshWidth, refreshHeight);
        refreshWidth = refreshHeight = 0;

        //logInfo("V990 REFRESH. currentScanline: " + currentScanline);
    }

    function beginFrame() {
        // Adjust for pending VideoStandard/Pulldown changes
        if (framePulldown !== pulldown) {
            frameVideoStandard = videoStandard;
            framePulldown = pulldown;
            updateSignalMetrics(false);
        }

        currentScanline = 0;
        frameStartingActiveScanline = startingActiveScanline;

        if (renderMetricsChangePending) updateRenderMetrics(true);

        // Page blinking per frame
        if (!blinkPerLine && blinkPageDuration > 0) clockPageBlinking();

        // Field alternance
        oldStatus[2] ^= 0x02;                    // Invert EO (Display Field flag)

        // Interlace
        if (register[9] & 0x08) {                                           // IL
            bufferPosition = (oldStatus[2] & 0x02) ? LINE_WIDTH : 0;       // EO
            bufferLineAdvance = LINE_WIDTH * 2;
        } else {
            bufferPosition = 0;
            bufferLineAdvance = LINE_WIDTH;
        }

        // Update mask to reflect correct page (Blink and EO)
        updateLayoutTableAddressMask();
    }

    function finishFrame() {
        //var cpuCycles = cpu.getCycles();
        //wmsx.Util.log("Frame FINISHED. CurrentScanline: " + currentScanline + ", CPU cycles: " + (cpuCycles - debugFrameStartCPUCycle));
        //debugFrameStartCPUCycle = cpuCycles;

        // Update frame image from backbuffer
        refreshWidth = renderWidth;
        refreshHeight = renderHeight;
        frameContext.putImageData(frameImageData, 0, 0, 0, 0, refreshWidth, refreshHeight);
        frame = frame + 1;

        //logInfo("Finish Frame");

        beginFrame();
    }

    function refreshDisplayMetrics() {
        videoSignal.setDisplayMetrics(wmsx.V9990.SIGNAL_MAX_WIDTH, wmsx.V9990.SIGNAL_MAX_HEIGHT);
    }

    function initRegisters() {
        wmsx.Util.arrayFill(register, 0);
        wmsx.Util.arrayFill(paletteData, 0);
        wmsx.Util.arrayFill(oldStatus, 0);
        register[7] = videoStandard === wmsx.VideoStandard.PAL ? 0x08 : 0;      // PAL mode bit
    }

    function initFrameResources(useAlpha) {
        if (frameCanvas && (frameContextUsingAlpha || !useAlpha)) return;       // never go back to non alpha

        frameContextUsingAlpha = !!useAlpha;
        frameCanvas = document.createElement('canvas');
        // Maximum VPD resolution including borders
        frameCanvas.width = wmsx.V9990.SIGNAL_MAX_WIDTH;
        frameCanvas.height = wmsx.V9990.SIGNAL_MAX_HEIGHT;
        frameContext = frameCanvas.getContext("2d", { alpha: frameContextUsingAlpha, antialias: false });

        if (!frameImageData) {
            frameImageData = frameContext.createImageData(frameCanvas.width, frameCanvas.height + 1 + 1);                                               // One extra line for right-overflow and one for the backdrop cache
            frameBackBuffer = new Uint32Array(frameImageData.data.buffer, 0, frameCanvas.width * (frameCanvas.height + 1));                             // One extra line
            backdropFullLineCache = new Uint32Array(frameImageData.data.buffer, frameCanvas.width * (frameCanvas.height + 1) * 4, frameCanvas.width);   // Second extra line
        }
    }

    function initColorPalette() {
        var colors = colorPaletteInitialV9938;
        for (var c = 0; c < 16; c = c + 1) {
            paletteData[c] = paletteRegisterInitialValuesV9938[c];
            var value = colors[c];
            colorPaletteReal[c] = value;
            if (debugModeSpriteHighlight) value &= DEBUG_DIM_ALPHA_MASK;
            colorPalette[c] = value;
            colorPaletteSolid[c] = value;
        }
    }

    function initColorCaches() {
        // Pre calculate all 512 colors encoded in 9 bits, and all 256 colors encoded in 8 bits
        for (var c = 0; c <= 0x1ff; c++) {
            if (c & 1) colors256[c >>> 1] = 0xff000000 | (color2to8bits[(c >>> 1) & 0x3] << 16) | (color3to8bits[c >>> 6] << 8) | color3to8bits[(c >>> 3) & 0x7];
            colors512[c] = 0xff000000 | (color3to8bits[c & 0x7] << 16) | (color3to8bits[c >>> 6] << 8) | color3to8bits[(c >>> 3) & 0x7];
        }
    }

    function initDebugPatternTables() {
        var digitPatterns = [
            ["111", "101", "101", "101", "111"], ["110", "010", "010", "010", "111"], ["111", "001", "111", "100", "111"], ["111", "001", "111", "001", "111"], ["101", "101", "111", "001", "001"],
            ["111", "100", "111", "001", "111"], ["111", "100", "111", "101", "111"], ["111", "001", "001", "001", "001"], ["111", "101", "111", "101", "111"], ["111", "101", "111", "001", "001"],
            ["110", "001", "111", "101", "111"], ["100", "100", "111", "101", "110"], ["000", "111", "100", "100", "111"], ["001", "001", "111", "101", "111"], ["110", "101", "111", "100", "011"], ["011", "100", "110", "100", "100"]
        ];
        var pos6 = DEBUG_PAT_DIGI6_TABLE_ADDRESS, pos8 = DEBUG_PAT_DIGI8_TABLE_ADDRESS, pos16 = DEBUG_PAT_DIGI16_TABLE_ADDRESS, posB = DEBUG_PAT_BLOCK_TABLE_ADDRESS;
        for (var info = 0; info < 256; info++) {
            var dig1 = (info / 16) | 0;
            var dig2 = info % 16;
            // 8 x 8, 6 x 8
            for (var i = 0; i < 5; i++) {
                vram[pos6++] = parseInt(digitPatterns[dig1][i] + digitPatterns[dig2][i] + "00", 2);
                vram[pos8++] = parseInt(digitPatterns[dig1][i] + "0" + digitPatterns[dig2][i] + "0", 2);
            }
            vram[pos6++] = vram[pos8++] = parseInt("00000000", 2);
            vram[pos6++] = vram[pos8++] = parseInt("01111100", 2);
            vram[pos6++] = vram[pos8++] = parseInt("00000000", 2);
            // 16 x 16
            vram[pos16++] = parseInt("11111111", 2);
            for (i = 0; i < 4; i++) vram[pos16++] = parseInt("10000000", 2);
            for (i = 0; i < 5; i++) vram[pos16++] = parseInt("1000" + digitPatterns[dig1][i] + "0", 2);
            for (i = 0; i < 5; i++) vram[pos16++] = parseInt("10000000", 2);
            for (i = 0; i < 2; i++) vram[pos16++] = parseInt("11111111", 2);
            for (i = 0; i < 4; i++) vram[pos16++] = parseInt("00000001", 2);
            for (i = 0; i < 5; i++) vram[pos16++] = parseInt("0" + digitPatterns[dig2][i] + "0001", 2);
            for (i = 0; i < 5; i++) vram[pos16++] = parseInt("00000001", 2);
            vram[pos16++] = parseInt("11111111", 2);
        }
        vram[posB] = vram [posB + 7] = 0;
        vram[posB + 1] = vram[posB + 2] = vram[posB + 3] = vram[posB + 4] = vram[posB + 5] = vram[posB + 6] = 0x7e;
    }

    function initSpritesConflictMap() {
        wmsx.Util.arrayFill(spritesLinePriorities, SPRITE_MAX_PRIORITY);
        wmsx.Util.arrayFill(spritesLineColors, 0);
        spritesGlobalPriority = SPRITE_MAX_PRIORITY;      // Decreasing value for sprite priority control. Never resets and lasts for years!
    }


    var LINE_WIDTH = wmsx.V9990.SIGNAL_MAX_WIDTH;
    var SPRITE_MAX_PRIORITY = 9000000000000000;
    var DEBUG_DIM_ALPHA_MASK = 0x40ffffff;

    var VRAM_LIMIT = wmsx.V9990.VRAM_LIMIT + 1;
    var DEBUG_PAT_DIGI6_TABLE_ADDRESS = VRAM_LIMIT;                                      // Debug pattern tables placed on top of normal VRAM
    var DEBUG_PAT_DIGI8_TABLE_ADDRESS = DEBUG_PAT_DIGI6_TABLE_ADDRESS + 256 * 8;
    var DEBUG_PAT_DIGI16_TABLE_ADDRESS = DEBUG_PAT_DIGI8_TABLE_ADDRESS + 256 * 8;
    var DEBUG_PAT_BLOCK_TABLE_ADDRESS = DEBUG_PAT_DIGI16_TABLE_ADDRESS + 256 * 8 * 4;
    var VRAM_TOTAL_SIZE = DEBUG_PAT_BLOCK_TABLE_ADDRESS + 8;

    var STARTING_DEBUG_MODE = WMSX.DEBUG_MODE;
    var STARTING_SPRITES_DEBUG_MODE = WMSX.SPRITES_DEBUG_MODE;

    // Frame as off screen canvas
    var frameCanvas, frameContext, frameImageData, frameBackBuffer;
    var backdropFullLineCache;        // Cached full line backdrop values, will share the same buffer as the frame itself for fast copying
    var frameContextUsingAlpha = false;

    var vram = wmsx.Util.arrayFill(new Array(VRAM_TOTAL_SIZE), 0);
    this.vram = vram;
    var vramInterleaving;

    var frame;
    var blinkEvenPage, blinkPageDuration, blinkPerLine;

    var vSynchMode;
    var videoStandard, pulldown;

    var bufferPosition;
    var bufferLineAdvance;
    var currentScanline;

    var cycles, lastBUSCyclesComputed;

    var signalActiveHeight;
    var finishingScanline;
    var startingActiveScanline, frameStartingActiveScanline;
    var startingVisibleTopBorderScanline;
    var startingInvisibleScanline;

    var frameVideoStandard, framePulldown;                  // Delays VideoStandard change until next frame

    var verticalIntReached = false;
    var horizontalIntLine = 0;

    var oldStatus = new Array(10);

    var status = 0, interruptFlags = 0, systemControl = 0;
    var registerSelect = 0, registerSelectReadInc = true, registerSelectWriteInc = true;
    var vramPointerRead = 0, vramPointerWrite = 0, vramPointerReadInc = true, vramPointerWriteInc = true, vramReadData = 0;
    var palettePointer = 0, palletePointerInc = true;

    var register = new Array(64);
    var paletteData = new Array(256);   // 64 entries x 3+1 bytes (R, G, B, spare)

    var modeData;

    var renderMetricsChangePending, renderWidth, renderHeight;
    var refreshWidth, refreshHeight;

    var blankingChangePending;
    var pendingBackdropCacheUpdate;

    var spritesEnabled, spritesSize, spritesMag;
    var spritesCollided, spritesInvalid, spritesMaxComputed, spritesCollisionX, spritesCollisionY;
    var spritesLinePriorities = new Array(256);
    var spritesLineColors = new Array(256);
    var spritesGlobalPriority;

    var backdropColor;
    var backdropValue;
    var backdropTileOdd, backdropTileEven;

    var verticalAdjust, horizontalAdjust;

    var leftMask, leftScroll2Pages, leftScrollChars, leftScrollCharsInPage, rightScrollPixels;

    var layoutTableAddress;                         // Dynamic values, set by program
    var colorTableAddress;
    var patternTableAddress;
    var spriteAttrTableAddress;
    var spritePatternTableAddress;

    var layoutTableAddressMask;                     // Dynamic values, depends on mode
    var layoutTableAddressMaskSetValue;             // Will contain the orignal mask, with no Alternative Page included
    var colorTableAddressMask;
    var patternTableAddressMask;

    var layoutTableAddressMaskBase = ~(-1 << 10);   // Fixed base values for all modes
    var colorTableAddressMaskBase = ~(-1 << 6);
    var patternTableAddressMaskBase = ~(-1 << 11);

    var modes = {};

    modes[  -1] = { name: "BL", renderLine: renderLineBlanked };
    modes[0x00] = { name: "P1", renderLine: renderLineBlanked };
    modes[0x05] = { name: "P2", renderLine: renderLineBlanked };
    modes[0x08] = { name: "B1", renderLine: renderLineBlanked };
    modes[0x28] = { name: "B2", renderLine: renderLineBlanked };
    modes[0x09] = { name: "B3", renderLine: renderLineBlanked };
    modes[0x2a] = { name: "B4", renderLine: renderLineBlanked };
    modes[0x0a] = { name: "B5", renderLine: renderLineBlanked };
    modes[0x1a] = { name: "B6", renderLine: renderLineBlanked };

    var modesOld = wmsx.Util.arrayFill(new Array(0x24),
                  { name: "NUL", isV9938: true,  layTBase:        0, colorTBase:        0, patTBase:        0, sprAttrTBase:        0, width: 256, layLineBytes:   0, evenPageMask:         ~0, blinkPageMask:         ~0, renderLine:   renderLineBlanked, renderLinePatInfo:       renderLineBlanked, ppb: 0, spriteMode: 0, tiled: false, vramInter:  null, bdPaletted:  true, textCols: 0 });

    modesOld[0x10] = { name:  "T1", isV9938: false, layTBase: -1 << 10, colorTBase:        0, patTBase: -1 << 11, sprAttrTBase:        0, width: 256, layLineBytes:   0, evenPageMask: ~(1 << 15), blinkPageMask:         ~0, renderLine:    renderLineModeT1, renderLinePatInfo: renderLineModeT1PatInfo, ppb: 0, spriteMode: 0, tiled: false, vramInter: false, bdPaletted:  true, textCols: 40 };
    modesOld[0x12] = { name:  "T2", isV9938: true,  layTBase: -1 << 12, colorTBase: -1 <<  9, patTBase: -1 << 11, sprAttrTBase:        0, width: 512, layLineBytes:   0, evenPageMask: ~(1 << 15), blinkPageMask:         ~0, renderLine:    renderLineModeT2, renderLinePatInfo: renderLineModeT2PatInfo, ppb: 0, spriteMode: 0, tiled: false, vramInter: false, bdPaletted:  true, textCols: 80 };
    modesOld[0x08] = { name:  "MC", isV9938: false, layTBase: -1 << 10, colorTBase:        0, patTBase: -1 << 11, sprAttrTBase: -1 <<  7, width: 256, layLineBytes:   0, evenPageMask: ~(1 << 15), blinkPageMask:         ~0, renderLine:    renderLineModeMC, renderLinePatInfo: renderLineModeMCPatInfo, ppb: 0, spriteMode: 1, tiled: false, vramInter: false, bdPaletted:  true, textCols: 0 };
    modesOld[0x00] = { name:  "G1", isV9938: false, layTBase: -1 << 10, colorTBase: -1 <<  6, patTBase: -1 << 11, sprAttrTBase: -1 <<  7, width: 256, layLineBytes:   0, evenPageMask: ~(1 << 15), blinkPageMask:         ~0, renderLine:    renderLineModeG1, renderLinePatInfo: renderLineModeG1PatInfo, ppb: 0, spriteMode: 1, tiled: false, vramInter: false, bdPaletted:  true, textCols: 32 };
    modesOld[0x01] = { name:  "G2", isV9938: false, layTBase: -1 << 10, colorTBase: -1 << 13, patTBase: -1 << 13, sprAttrTBase: -1 <<  7, width: 256, layLineBytes:   0, evenPageMask: ~(1 << 15), blinkPageMask:         ~0, renderLine:    renderLineModeG2, renderLinePatInfo: renderLineModeG2PatInfo, ppb: 0, spriteMode: 1, tiled: false, vramInter: false, bdPaletted:  true, textCols: 0 };
    modesOld[0x02] = { name:  "G3", isV9938: true,  layTBase: -1 << 10, colorTBase: -1 << 13, patTBase: -1 << 13, sprAttrTBase: -1 << 10, width: 256, layLineBytes:   0, evenPageMask: ~(1 << 15), blinkPageMask: ~(1 << 15), renderLine:    renderLineModeG3, renderLinePatInfo: renderLineModeG3PatInfo, ppb: 0, spriteMode: 2, tiled: false, vramInter: false, bdPaletted:  true, textCols: 0 };
    modesOld[0x03] = { name:  "G4", isV9938: true,  layTBase: -1 << 15, colorTBase:        0, patTBase:        0, sprAttrTBase: -1 << 10, width: 256, layLineBytes: 128, evenPageMask: ~(1 << 15), blinkPageMask: ~(1 << 15), renderLine:    renderLineModeG4, renderLinePatInfo:        renderLineModeG4, ppb: 2, spriteMode: 2, tiled: false, vramInter: false, bdPaletted:  true, textCols: 0 };
    modesOld[0x04] = { name:  "G5", isV9938: true,  layTBase: -1 << 15, colorTBase:        0, patTBase:        0, sprAttrTBase: -1 << 10, width: 512, layLineBytes: 128, evenPageMask: ~(1 << 15), blinkPageMask: ~(1 << 15), renderLine:    renderLineModeG5, renderLinePatInfo:        renderLineModeG5, ppb: 4, spriteMode: 2, tiled:  true, vramInter: false, bdPaletted:  true, textCols: 0 };
    modesOld[0x05] = { name:  "G6", isV9938: true,  layTBase: -1 << 16, colorTBase:        0, patTBase:        0, sprAttrTBase: -1 << 10, width: 512, layLineBytes: 256, evenPageMask: ~(1 << 16), blinkPageMask: ~(1 << 16), renderLine:    renderLineModeG6, renderLinePatInfo:        renderLineModeG6, ppb: 2, spriteMode: 2, tiled: false, vramInter:  true, bdPaletted:  true, textCols: 0 };
    modesOld[0x07] = { name:  "G7", isV9938: true,  layTBase: -1 << 16, colorTBase:        0, patTBase:        0, sprAttrTBase: -1 << 10, width: 256, layLineBytes: 256, evenPageMask: ~(1 << 16), blinkPageMask: ~(1 << 16), renderLine:    renderLineModeG7, renderLinePatInfo:        renderLineModeG7, ppb: 1, spriteMode: 2, tiled: false, vramInter:  true, bdPaletted: false, textCols: 0 };
    modesOld[0x21] = { name: "YJK", isV9938: true,  layTBase: -1 << 16, colorTBase:        0, patTBase:        0, sprAttrTBase: -1 << 10, width: 256, layLineBytes: 256, evenPageMask: ~(1 << 16), blinkPageMask: ~(1 << 16), renderLine:   renderLineModeYJK, renderLinePatInfo:       renderLineModeYJK, ppb: 1, spriteMode: 2, tiled: false, vramInter:  true, bdPaletted:  true, textCols: 0 };
    modesOld[0x23] = { name: "YAE", isV9938: true,  layTBase: -1 << 16, colorTBase:        0, patTBase:        0, sprAttrTBase: -1 << 10, width: 256, layLineBytes: 256, evenPageMask: ~(1 << 16), blinkPageMask: ~(1 << 16), renderLine:   renderLineModeYAE, renderLinePatInfo:       renderLineModeYAE, ppb: 1, spriteMode: 2, tiled: false, vramInter:  true, bdPaletted:  true, textCols: 0 };

    var renderLine, renderLineActive;         // Update functions for current mode

    var colors256 = new Uint32Array(256);       // 32 bit ABGR values for 8 bit GRB colors
    var colors512 = new Uint32Array(512);       // 32 bit ABGR values for 9 bit GRB colors
    var color2to8bits = [ 0, 73, 146, 255 ];
    var color3to8bits = [ 0, 36, 73, 109, 146, 182, 219, 255 ];
    var color5to8bits = [ 0, 8, 16, 24, 32, 41, 49, 57, 65, 74, 82, 90, 98, 106, 115, 123, 131, 139, 148, 156, 164, 172, 180, 189, 197, 205, 213, 222, 230, 238, 246, 255 ];

    var color0Solid = false;
    var colorPalette =      new Uint32Array(16);     // 32 bit ABGR palette values ready to paint with transparency pre-computed in position 0, dimmed when in debug
    var colorPaletteSolid = new Uint32Array(16);     // 32 bit ABGR palette values ready to paint with real solid palette values, dimmed when in debug
    var colorPaletteReal =  new Uint32Array(16);     // 32 bit ABGR palette values ready to paint with real solid palette values, used for Sprites, NEVER dimmed for debug

    var spritePaletteG7 =          new Uint32Array([ 0xff000000, 0xff490000, 0xff00006d, 0xff49006d, 0xff006d00, 0xff496d00, 0xff006d6d, 0xff496d6d, 0xff4992ff, 0xffff0000, 0xff0000ff, 0xffff00ff, 0xff00ff00, 0xffffff00, 0xff00ffff, 0xffffffff ]);

    var colorPaletteInitialV9938 = new Uint32Array([ 0xff000000, 0xff000000, 0xff24db24, 0xff6dff6d, 0xffff2424, 0xffff6d49, 0xff2424b6, 0xffffdb49, 0xff2424ff, 0xff6d6dff, 0xff24dbdb, 0xff92dbdb, 0xff249224, 0xffb649db, 0xffb6b6b6, 0xffffffff ]);
    var paletteRegisterInitialValuesV9938 =        [      0x000,      0x000,      0x611,      0x733,      0x117,      0x327,      0x151,      0x627,      0x121,      0x373,      0x661,      0x664,      0x411,      0x265,      0x365,      0x777 ];


   // Sprite and Debug Modes controls

    var debugMode = 0;
    var debugModeSpriteHighlight = false, debugModeSpriteInfo = false, debugModeSpriteInfoNumbers = false, debugModeSpritesHidden = false;
    var debugModePatternInfo = false, debugModePatternInfoBlocks = false, debugModePatternInfoNames = false;

    var spriteDebugMode = 0;
    var spriteDebugModeLimit = true;
    var spriteDebugModeCollisions = true;

    var debugBackdropValue    = 0xff2a2a2a;

    var debugLineStartBUSCycles = 0;


    // Connections

    var videoSignal;
    var commandProcessor;

    var slave;

    // Savestate  -------------------------------------------

    this.saveState = function(extended) {
        var s = {
            l: currentScanline, b: bufferPosition, ba: bufferLineAdvance, ad: renderLine === renderLineActive,
            fs: frameStartingActiveScanline,
            f: frame, c: cycles, cc: lastBUSCyclesComputed,
            vp: vramPointerWrite,
            ha: horizontalAdjust, va: verticalAdjust, hil: horizontalIntLine,
            lm: leftMask, ls2: leftScroll2Pages, lsc: leftScrollChars, rsp: rightScrollPixels,
            bp: blinkEvenPage, bpd: blinkPageDuration, bpl: blinkPerLine,
            sc: spritesCollided, sx: spritesCollisionX, sy: spritesCollisionY, si: spritesInvalid, sm: spritesMaxComputed,
            vi: verticalIntReached,
            r: wmsx.Util.storeInt8BitArrayToStringBase64(register), s: wmsx.Util.storeInt8BitArrayToStringBase64(oldStatus),
            p: wmsx.Util.storeInt16BitArrayToStringBase64(paletteData),
            vram: wmsx.Util.compressInt8BitArrayToStringBase64(vram, VRAM_LIMIT),
            vrint: vramInterleaving,
            cp: commandProcessor.saveState()
        };
        if (extended) {
            s.dm = debugMode;
            s.sd = spriteDebugMode;
        }
        return s;
    };

    this.loadState = function(s) {
        refreshDisplayMetrics();
        register = wmsx.Util.restoreStringBase64ToInt8BitArray(s.r, register);
        oldStatus = wmsx.Util.restoreStringBase64ToInt8BitArray(s.s, oldStatus);
        paletteData = wmsx.Util.restoreStringBase64ToInt16BitArray(s.p, paletteData);
        vram = wmsx.Util.uncompressStringBase64ToInt8BitArray(s.vram, vram, true);
        currentScanline = s.l; bufferPosition = s.b; bufferLineAdvance = s.ba;
        if (s.ad) setActiveDisplay(); else setBorderDisplay();
        frame = s.f || 0; cycles = s.c; lastBUSCyclesComputed = s.cc;
        vramPointerWrite = s.vp;
        horizontalAdjust = s.ha; verticalAdjust = s.va; horizontalIntLine = s.hil;
        leftMask = s.lm; leftScroll2Pages = s.ls2; leftScrollChars = s.lsc; rightScrollPixels = s.rsp;
        leftScrollCharsInPage = leftScrollChars & 31;
        blinkEvenPage = s.bp; blinkPageDuration = s.bpd; blinkPerLine = s.bpl !== undefined ? s.bpl : (register[1] & 0x04) !== 0;
        spritesCollided = s.sc; spritesCollisionX = s.sx; spritesCollisionY = s.sy; spritesInvalid = s.si; spritesMaxComputed = s.sm;
        verticalIntReached = s.vi;
        vramInterleaving = s.vrint;
        commandProcessor.loadState(s.cp);
        commandProcessor.connectVDP(this, vram, register, oldStatus);
        frameVideoStandard = videoStandard; framePulldown = pulldown;
        updateSignalMetrics(true);
        if (s.fs !== undefined) frameStartingActiveScanline = s.fs;       // backward compatibility
        updateIRQ();
        updateMode();
        updateSpritesConfig();
        debugAdjustPalette();
        updateBackdropColor();
        updateTransparency();
        updateRenderMetrics(true);

        // Extended
        if (s.dm !== undefined) setDebugMode(s.dm);
        if (s.sd !== undefined) setSpriteDebugMode(s.sd);
    };


    init();

    // this.TEST = 0;

    function logInfo(text) {
        var busLineCycles = cpu.getBUSCycles() - debugLineStartBUSCycles;
        var vdpLineCycles = busLineCycles * 6;
        console.log("V9990 " + text
            // + ". Frame: " + frame
            + ", currentScanLine: " + currentScanline
            + ", activeRenderScanline: " + (currentScanline - frameStartingActiveScanline)
            + ", activeHeigh: " + signalActiveHeight
            // + ", x: " + ((vdpLineCycles - 258) / 4) + ", vdpCycle:" + vdpLineCycles + ", cpuCycle: " + busLineCycles
        );
    }
    this.logInfo = logInfo;

    this.eval = function(str) {
        return eval(str);
    };

    window.V9990 = this;

};

wmsx.V9990.VRAM_LIMIT = 0x7ffff;      // 512K

wmsx.V9990.SIGNAL_MAX_WIDTH =   512 + 16 * 2;
wmsx.V9990.SIGNAL_MAX_HEIGHT = (212 + 8 * 2) * 2;

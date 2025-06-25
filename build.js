#!/usr/bin/env node

/**
 * 🚀 Universal Build Script for tool-play-club
 * Works on both Mac and Windows - Just double-click to run!
 * 
 * Usage:
 * - macOS/Linux: node build.js
 * - Windows: double-click build.js (if Node.js is associated)
 * - Or run: node build.js
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectDir = __dirname;

// Colors for cross-platform console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Platform detection
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// Output executable name
const exeName = isWindows ? 'tool-play-club.exe' : 'tool-play-club';
const outputPath = join(projectDir, 'dist', exeName);

function colorLog(color, message) {
    if (isWindows) {
        // Windows might not support colors well in some terminals
        console.log(message);
    } else {
        console.log(`${colors[color]}${message}${colors.reset}`);
    }
}

function printHeader() {
    console.clear();
    colorLog('cyan', '🚀 Universal Build Script for tool-play-club');
    colorLog('blue', `Platform: ${process.platform} (${process.arch})`);
    colorLog('blue', `Node.js: ${process.version}`);
    console.log('='.repeat(50));
}

function checkFile(filename, description) {
    if (existsSync(join(projectDir, filename))) {
        colorLog('green', `✅ ${description} found`);
        return true;
    } else {
        colorLog('red', `❌ ${description} not found!`);
        return false;
    }
}

function runCommand(command, description, options = {}) {
    try {
        colorLog('blue', `🔄 ${description}...`);
        const result = execSync(command, {
            cwd: projectDir,
            stdio: 'pipe',
            encoding: 'utf8',
            ...options
        });
        colorLog('green', `✅ ${description} completed`);
        return { success: true, output: result };
    } catch (error) {
        colorLog('red', `❌ ${description} failed`);
        if (error.stdout) console.log('stdout:', error.stdout);
        if (error.stderr) console.log('stderr:', error.stderr);
        return { success: false, error };
    }
}

function checkBunInstallation() {
    try {
        const result = execSync('bun --version', { encoding: 'utf8', stdio: 'pipe' });
        colorLog('green', `✅ Bun found (v${result.trim()})`);
        return true;
    } catch (error) {
        colorLog('yellow', '⚠️  Bun not found');
        return false;
    }
}

async function installBun() {
    colorLog('blue', '📥 Installing Bun...');
    
    if (isWindows) {
        colorLog('yellow', '⚠️  Windows detected');
        colorLog('blue', 'Please install Bun manually:');
        console.log('1. Visit: https://bun.sh');
        console.log('2. Follow Windows installation instructions');
        console.log('3. Restart this script');
        await waitForKeyPress();
        process.exit(1);
    } else {
        // macOS/Linux
        const result = runCommand(
            'curl -fsSL https://bun.sh/install | bash',
            'Installing Bun via curl'
        );
        
        if (result.success) {
            // Try to update PATH for current session
            const bunPath = join(process.env.HOME, '.bun', 'bin');
            process.env.PATH = `${bunPath}:${process.env.PATH}`;
            
            // Check if bun is now available
            if (checkBunInstallation()) {
                return true;
            } else {
                colorLog('yellow', '⚠️  Bun installed but not in PATH');
                colorLog('blue', 'Please restart your terminal and run this script again');
                await waitForKeyPress();
                process.exit(1);
            }
        }
        return false;
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function waitForKeyPress() {
    colorLog('yellow', '\nPress any key to continue...');
    process.stdin.setRawMode(true);
    return new Promise(resolve => process.stdin.once('data', () => {
        process.stdin.setRawMode(false);
        resolve();
    }));
}

async function askYesNo(question) {
    colorLog('yellow', `${question} (y/n): `);
    process.stdout.write('> ');
    
    return new Promise((resolve) => {
        process.stdin.once('data', (data) => {
            const answer = data.toString().trim().toLowerCase();
            resolve(answer === 'y' || answer === 'yes');
        });
    });
}

async function main() {
    try {
        printHeader();
        
        // Step 1: Check project files
        colorLog('blue', '\n📁 Checking project files...');
        if (!checkFile('index.js', 'index.js')) {
            colorLog('red', 'Make sure this script is in the same directory as index.js');
            await waitForKeyPress();
            process.exit(1);
        }
        
        // Step 2: Check/Install Bun
        colorLog('blue', '\n🔍 Checking Bun installation...');
        if (!checkBunInstallation()) {
            const shouldInstall = await askYesNo('Bun not found. Install it now?');
            if (shouldInstall) {
                await installBun();
            } else {
                colorLog('red', 'Bun is required to build the executable');
                await waitForKeyPress();
                process.exit(1);
            }
        }
        
        // Step 3: Install dependencies
        if (existsSync(join(projectDir, 'package.json'))) {
            colorLog('blue', '\n📦 Installing dependencies...');
            const installResult = runCommand('bun install', 'Installing dependencies');
            if (!installResult.success) {
                colorLog('red', 'Failed to install dependencies');
                await waitForKeyPress();
                process.exit(1);
            }
        }
        
        // Step 4: Create dist directory
        const distDir = join(projectDir, 'dist');
        if (!existsSync(distDir)) {
            mkdirSync(distDir, { recursive: true });
            colorLog('green', '✅ Created dist directory');
        }
        
        // Step 5: Build executable
        colorLog('blue', '\n🔨 Building executable...');
        const buildCommand = `bun build --compile ./index.js --outfile "${outputPath}"`;
        colorLog('cyan', `Command: ${buildCommand}`);
        
        const buildResult = runCommand(buildCommand, 'Building executable');
        
        if (buildResult.success && existsSync(outputPath)) {
            // Success!
            const stats = statSync(outputPath);
            const fileSize = formatFileSize(stats.size);
            
            console.log('\n' + '='.repeat(50));
            colorLog('green', '🎉 BUILD SUCCESSFUL! 🎉');
            console.log('='.repeat(50));
            colorLog('cyan', `📁 Executable: ${outputPath}`);
            colorLog('cyan', `📊 Size: ${fileSize}`);
            colorLog('cyan', `🏃 Run with: ${isWindows ? '' : './'}${join('dist', exeName)}`);
            
            // Ask to test
            const shouldTest = await askYesNo('\n🧪 Test the executable now?');
            if (shouldTest) {
                colorLog('blue', '\n🚀 Running executable...');
                try {
                    const testProcess = spawn(outputPath, [], {
                        stdio: 'inherit',
                        cwd: projectDir
                    });
                    
                    testProcess.on('close', (code) => {
                        if (code === 0) {
                            colorLog('green', '\n✅ Executable ran successfully!');
                        } else {
                            colorLog('yellow', `\n⚠️  Executable exited with code: ${code}`);
                        }
                    });
                } catch (error) {
                    colorLog('red', `❌ Failed to run executable: ${error.message}`);
                }
            }
            
        } else {
            colorLog('red', '\n❌ Build failed!');
            console.log('\nCommon solutions:');
            console.log('1. Make sure index.js is valid');
            console.log('2. Check if all dependencies are installed');
            console.log('3. Try running: bun install');
            console.log('4. Make sure you have write permissions');
        }
        
        await waitForKeyPress();
        
    } catch (error) {
        colorLog('red', `\n💥 Unexpected error: ${error.message}`);
        console.error(error);
        await waitForKeyPress();
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    colorLog('yellow', '\n\n👋 Build cancelled by user');
    process.exit(0);
});

process.on('SIGTERM', () => {
    colorLog('yellow', '\n\n👋 Build terminated');
    process.exit(0);
});

// Run main function
main().catch(error => {
    colorLog('red', `Fatal error: ${error.message}`);
    process.exit(1);
});
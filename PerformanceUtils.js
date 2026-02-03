/**
 * Performance Utilities for Lyruanna
 */

class ObjectPool {
    /**
     * @param {Function} factory - Function that returns a new object instance.
     * @param {number} initialSize - Initial number of objects to create.
     */
    constructor(factory, initialSize = 0) {
        this.factory = factory;
        this.pool = [];
        this.index = 0;

        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.factory());
        }
    }

    /**
     * Borrow an object from the pool. If empty, creates a new one.
     */
    borrow() {
        if (this.index >= this.pool.length) {
            this.pool.push(this.factory());
        }
        return this.pool[this.index++];
    }

    /**
     * Resets the pointer to the start of the pool.
     * Should be called at the beginning of each frame.
     */
    reset() {
        this.index = 0;
    }

    /**
     * Returns the current number of objects in the pool.
     */
    get size() {
        return this.pool.length;
    }

    /**
     * Returns the number of objects currently in use this frame.
     */
    get inUse() {
        return this.index;
    }
}

// Export for Web and Desktop
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ObjectPool };
} else {
    window.ObjectPool = ObjectPool;
}

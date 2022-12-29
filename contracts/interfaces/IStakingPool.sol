// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Pool object structure
 */
struct Pool {
    // Unique identifier for the pool
    // Generated out of (destination, doLiquify, doSwapForBusd, swapOrLiquifyAmount) to
    // always use the same feeEntryAmounts entry.
    bytes32 id;
    // Last block rewards were paid
    uint256 lastRewardBlock;
}

/**
 * Pool staking entry object structure
 */
struct PoolEntry {
    // Initial amount of staked token
    uint256 amount;
    // Stake lock duration (in days)
    uint256 duration;
    // Amount of pool shares
    uint256 shares;
    // Amount of claimed rewards
    uint256 claimedRewards;
    // Timestamp of last rewards claim
    uint256 lastClaimedAt;
    // Block number of staking start
    uint256 startBlock;
    // Indiciator, if auto compounding should be used
    bool isAutoCompoundingEnabled;
}

interface IStakingPool {
    /**
     * Current pool factor
     *
     * @return poolFactor uint256 - Current pool factor
     */
    function currentPoolFactor() external view returns (uint256 poolFactor);

    /**
     * Last block rewards were calculated at
     *
     * @return lastRewardBlock uint256 - Last block rewards were calculated at
     */
    function lastRewardBlock() external view returns (uint256 lastRewardBlock);

    /**
     * Total amount of pool shares available
     *
     * @return totalPoolShares uint256 - Total pool shares available
     */
    function totalPoolShares() external pure returns (uint256 totalPoolShares);

    /**
     * Total amount of allocated pool shares
     *
     * @return allocatedPoolShares uint256 - Amount of allocated pool shares
     */
    function allocatedPoolShares()
        external
        view
        returns (uint256 allocatedPoolShares);

    /**
     * Total amount of token locked inside the pool
     *
     * @return amount uint256 - Total amount of token locked
     */
    function totalTokenLocked() external pure returns (uint256 amount);

    /**
     * Max. staking duration in days
     *
     * @return duration uint256 - Max. staking duration
     */
    function maxDuration() external pure returns (uint256 duration);

    /**
     * Min. staking duration in days
     *
     * @return duration uint256 - Min. staking duration
     */
    function minDuration() external pure returns (uint256 duration);

    /**
     *
     */
    function maxAmount() external pure returns (uint256 amount);

    /**
     * Compounding interval in days
     * Ex. 730 ~= two times per day
     *
     * @return interval uint256 - Compounding interval
     */
    function compoundInterval() external pure returns (uint256 interval);

    /**
     * Staking pool balance in token
     *
     * @return amount uint256 - Pool balance
     */
    function poolBalance() external view returns (uint256 amount);

    function poolAllocation() external pure returns (uint256 allocation);

    function pendingRewards() external pure returns (uint256 pendingRewards);

    function token() external view returns (IERC20 token);

    /**
     * Calculates the APY in percent for given staking duration (days)
     *
     * @param duration uint256 - Staking duration in days
     *
     * @return apy uint256 - APY in percent multiplied by 1e5
     */
    function apy(uint256 duration) external view returns (uint256 apy);

    /**
     * Calculates the APY in percent for given staking duration (days)
     * and pool factor.
     *
     * @param duration uint256 - Staking duration in days
     * @param factor uint256 - Pool factor
     *
     * @return apy uint256 - APY in percent multiplied by 1e5
     */
    function apy(
        uint256 duration,
        uint256 factor
    ) external view returns (uint256 apy);

    /**
     * Calculates the APR in percent for given staking duration (days)
     *
     * @param duration uint256 - Staking duration in days
     *
     * @return apr uint256 - APR in percent multiplied by 1e5
     */
    function apr(uint256 duration) external view returns (uint256 apr);

    /**
     * Calculates the ARR in percent for given staking duration (days)
     * and pool factor.
     *
     * @param duration uint256 - Staking duration in days
     * @param factor uint256 - Pool factor
     *
     * @return apr uint256 - APR in percent multiplied by 1e5
     */
    function apr(
        uint256 duration,
        uint256 factor
    ) external view returns (uint256 apr);

    /**
     * Calculates the pool factor for given pool balance
     *
     * @param balance uint256 - Staking pool balance
     *
     * @return poolFactor uint256 - Pool factor in wei
     */
    function poolFactor(
        uint256 balance
    ) external view returns (uint256 poolFactor);

    function getEntries(
        address account
    ) external view returns (PoolEntry[] memory entries);

    function stake(
        uint256 amount,
        uint256 duration,
        bool enableAutoCompounding
    ) external returns (uint256 tokenId);

    function unstake(uint256 tokenId) external;

    function compound(bytes32 entryId) external;

    function updatePool() external;
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
    // Reward debt used for calculation
    uint256 rewardDebt;
    // Amount of claimed rewards (only if no auto compounding enabled)
    uint256 claimedRewards;
    // Timestamp of last rewards claim (only if no auto compounding enabled)
    uint256 lastClaimedAt;
    // Block timestamp of staking start
    uint256 startedAt;
    // Indicator, if entry was already unstaked
    bool isUnstaked;
    // Indicator, if auto compounding should be used
    bool isAutoCompoundingEnabled;
}

interface IStakingPool {
    // TODO: add events

    /**
     * Current pool factor
     *
     * @return poolFactor uint256 - Current pool factor
     */
    function currentPoolFactor() external view returns (uint256 poolFactor);

    /**
     * Last block timestamp rewards were calculated at
     *
     * @return lastRewardTimestamp uint256 - Last block timestamp rewards were calculated at
     */
    function lastRewardTimestamp()
        external
        view
        returns (uint256 lastRewardTimestamp);

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
     * Total amount of pool shares available
     *
     * @return totalPoolShares uint256 - Total pool shares available
     */
    function totalPoolShares() external pure returns (uint256 totalPoolShares);

    /**
     * Total amount of token locked inside the pool
     *
     * @return amount uint256 - Total amount of token locked
     */
    function totalTokenLocked() external view returns (uint256 amount);

    /**
     * Min. staking duration in days
     *
     * @return duration uint256 - Min. staking duration
     */
    function minDuration() external pure returns (uint256 duration);

    /**
     * Max. staking duration in days
     *
     * @return duration uint256 - Max. staking duration
     */
    function maxDuration() external pure returns (uint256 duration);

    /**
     * Compounding interval in days
     * Ex. 730 ~= two times per day
     *
     * @return interval uint256 - Compounding interval
     */
    function compoundInterval() external pure returns (uint256 interval);

    /**
     * Staking pool balance without locked token and allocated rewards
     *
     * @return amount uint256 - Pool balance
     */
    function poolBalance() external view returns (uint256 amount);

    /**
     * Returns a single staking pool entry
     *
     * @param tokenId uint256 - Staking token ID
     *
     * @return entry PoolEntry - Staking pool entry
     */
    function poolEntry(
        uint256 tokenId
    ) external view returns (PoolEntry memory entry);

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

    /**
     * Stakes token with the given parameters
     *
     * @param amount uint256 - Amount of token to stake
     * @param duration uint256 - Staking duration in days
     * @param enableAutoCompounding bool - Indicator, if auto compounding should be used
     *
     * @return tokenId uint256 - Reward token ID
     */
    function stake(
        uint256 amount,
        uint256 duration,
        bool enableAutoCompounding
    ) external returns (uint256 tokenId);

    /**
     * Unstakes staking entry
     *
     * @param tokenId uint256 - Reward token ID
     */
    function unstake(uint256 tokenId) external;

    /**
     * Claim rewards for given staking entry
     * Requires auto compounding to be disabled
     *
     * @param tokenId uint256 - Reward token ID
     */
    function claimRewards(uint256 tokenId) external;

    /**
     * Return pending / claimable rewards for staking entry
     *
     * @param tokenId uint256 - Reward token ID
     */
    function pendingRewards(
        uint256 tokenId
    ) external view returns (uint256 rewards);

    /**
     * Updates the pool calculations for rewards, etc.
     */
    function updatePool() external;
}

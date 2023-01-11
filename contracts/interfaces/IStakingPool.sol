// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IWeStakeitToken.sol";

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
    /**
     * Emitted when entering the staking pool
     *
     * @param tokenId uint256 - Proof token ID
     * @param amount uint256 - Initial amount of staked token
     * @param duration uint256 - Stake lock duration (in days)
     * @param shares uint256 - Amount of pool shares
     * @param isAutoCompoundingEnabled bool - Indicator, if auto compounding should be used
     *
     */
    event Staked(
        uint256 indexed tokenId,
        uint256 indexed amount,
        uint256 indexed duration,
        uint256 shares,
        bool isAutoCompoundingEnabled
    );

    /**
     * Emitted when leaving the staking pool
     *
     * @param tokenId uint256 - Proof token ID
     * @param amount uint256 - Initial amount of staked token
     * @param duration uint256 - Stake lock duration (in days)
     * @param shares uint256 - Amount of pool shares
     * @param isAutoCompoundingEnabled bool - Indicator, if auto compounding should be used
     *
     */
    event Unstaked(
        uint256 indexed tokenId,
        uint256 indexed amount,
        uint256 indexed duration,
        uint256 shares,
        bool isAutoCompoundingEnabled
    );

    /**
     * Emitted when entering the staking pool
     *
     * @param tokenId uint256 - Proof token ID
     * @param claimedRewards uint256 - Amount of rewards claimed
     *
     */
    event RewardsClaimed(
        uint256 indexed tokenId,
        uint256 indexed claimedRewards
    );

    /**
     * Set pool paused state
     *
     * @param value bool - true = Pause pool, false = Unpause pool
     */
    function setPoolPaused(bool value) external;

    /**
     * Set active allocated pool shares
     * This is only called by off-chain service
     *
     * @param value uint256 - New active allocated pool shares
     */
    function setActiveAllocatedPoolShares(uint256 value) external;

    /**
     * Calculates the APY in percent for given staking duration (days)
     *
     * @param duration uint256 - Staking duration in days
     *
     * @return value uint256 - APY in percent multiplied by 1e5
     */
    function apy(uint256 duration) external view returns (uint256 value);

    /**
     * Calculates the APR in percent for given staking duration (days)
     *
     * @param duration uint256 - Staking duration in days
     *
     * @return value uint256 - APR in percent multiplied by 1e5
     */
    function apr(uint256 duration) external view returns (uint256 value);

    /**
     * Returns pool paused state
     *
     * @return value bool - true = pool paused, false = pool unpaused
     */
    function poolPaused() external view returns (bool value);

    /**
     * Current pool factor
     *
     * @return value uint256 - Current pool factor
     */
    function currentPoolFactor() external view returns (uint256 value);

    /**
     * Last block timestamp rewards were calculated at
     *
     * @return value uint256 - Last block timestamp rewards were calculated at
     */
    function lastRewardTimestamp() external view returns (uint256 value);

    /**
     * Total amount of allocated pool shares
     *
     * @return value uint256 - Amount of allocated pool shares
     */
    function allocatedPoolShares() external view returns (uint256 value);

    /**
     * Last block timestamp active allocated pool shares were calculated at
     *
     * @return value uint256 - Last block timestamp active allocated pool shares calculated at
     */
    function activeAllocatedPoolShares() external view returns (uint256 value);

    /**
     * Total amount of active (within staking duration) allocated pool shares
     *
     * @return value uint256 - Amount of active allocated pool shares
     */
    function lastActiveAllocatedPoolSharesTimestamp()
        external
        view
        returns (uint256 value);

    /**
     * Accured rewards per pool share
     *
     * @return value uint256 - Accured rewards per pool share at lastRewardTimestamp
     */
    function accRewardsPerShare() external view returns (uint256 value);

    /**
     * Total amount of pool shares available
     *
     * @return value uint256 - Total pool shares available
     */
    function totalPoolShares() external pure returns (uint256 value);

    /**
     * Total amount of token locked inside the pool
     *
     * @return value uint256 - Total amount of token locked
     */
    function totalTokenLocked() external view returns (uint256 value);

    /**
     * Min. staking duration in days
     *
     * @return value uint256 - Min. staking duration
     */
    function minDuration() external pure returns (uint256 value);

    /**
     * Max. staking duration in days
     *
     * @return value uint256 - Max. staking duration
     */
    function maxDuration() external pure returns (uint256 value);

    /**
     * Compounding interval in days
     * Ex. 730 ~= two times per day
     *
     * @return value uint256 - Compounding interval
     */
    function compoundInterval() external pure returns (uint256 value);

    /**
     * Token used for staking
     *
     * @return value IERC20 - Token "instance" used for staking
     */
    function stakeToken() external view returns (IERC20 value);

    /**
     * Token used for staking rewards
     *
     * @return value IWeStakeitToken - Token "instance" used for rewards
     */
    function proofToken() external view returns (IWeStakeitToken value);

    /**
     * Staking pool balance without locked token and allocated rewards
     *
     * @return value uint256 - Pool balance
     */
    function poolBalance() external view returns (uint256 value);

    /**
     * Staking pool balance, calculated with pool factor, without locked
     * token and allocated rewards
     *
     * @param poolFactor_ uint256 - Pool factor
     *
     * @return value uint256 - Pool balance
     */
    function poolBalance(
        uint256 poolFactor_
    ) external view returns (uint256 value);

    /**
     * Returns a single staking pool entry
     *
     * @param tokenId uint256 - Staking token ID
     *
     * @return value PoolEntry - Staking pool entry
     */
    function poolEntry(
        uint256 tokenId
    ) external view returns (PoolEntry memory value);

    /**
     * Calculates the APY in percent for given staking duration
     * and pool factor.
     *
     * @param duration uint256 - Staking duration in days
     * @param factor uint256 - Pool factor
     *
     * @return value uint256 - APY in percent multiplied by 1e5
     */
    function apy(
        uint256 duration,
        uint256 factor
    ) external view returns (uint256 value);

    /**
     * Calculates the ARR in percent for given staking duration
     * and pool factor.
     *
     * @param duration uint256 - Staking duration in days
     * @param factor uint256 - Pool factor
     *
     * @return value uint256 - APR in percent multiplied by 1e5
     */
    function apr(
        uint256 duration,
        uint256 factor
    ) external view returns (uint256 value);

    /**
     * Calculates the pool factor
     *
     * @return value uint256 - Pool factor in wei
     */
    function poolFactor() external view returns (uint256 value);

    /**
     * Calculates the pool factor for given pool balance
     *
     * @param balance uint256 - Staking pool balance
     *
     * @return value uint256 - Pool factor in wei
     */
    function poolFactor(uint256 balance) external view returns (uint256 value);

    /**
     * Return accRewardsPerShare at best matching snapshot
     *
     * @param snapshotId uint256 - Snapshot ID / block timestamp to look for
     *
     * @return snapshotId_ uint256 - Best matching snapshot ID
     * @return snapshotValue uint256 - Value at the snapshot or fallback value, if no snapshot was found
     */
    function accRewardsPerShareAt(
        uint256 snapshotId
    ) external view returns (uint256 snapshotId_, uint256 snapshotValue);

    /**
     * Return lastRewardTimestamp at best matching snapshot
     *
     * @param snapshotId uint256 - Snapshot ID / block timestamp to look for
     *
     * @return snapshotId_ uint256 - Best matching snapshot ID
     * @return snapshotValue uint256 - Value at the snapshot or fallback value, if no snapshot was found
     */
    function lastRewardTimestampAt(
        uint256 snapshotId
    ) external view returns (uint256 snapshotId_, uint256 snapshotValue);

    /**
     * Max. amount a user is able to stake currently
     *
     * @return value uint256 - Max. staking amount
     */
    function maxStakingAmount() external view returns (uint256 value);

    /**
     * Stakes token with the given parameters
     *
     * @param amount uint256 - Amount of token to stake
     * @param duration uint256 - Staking duration in days
     * @param enableAutoCompounding bool - Indicator, if auto compounding should be used
     *
     * @return tokenId uint256 - Proof token ID
     */
    function stake(
        uint256 amount,
        uint256 duration,
        bool enableAutoCompounding
    ) external returns (uint256 tokenId);

    /**
     * Unstakes staking entry
     *
     * @param tokenId uint256 - Proof token ID
     */
    function unstake(uint256 tokenId) external;

    /**
     * Claim rewards for given staking entry
     *
     * @param tokenId uint256 - Proof token ID
     */
    function claimRewards(uint256 tokenId) external;

    /**
     * Return pending / claimable rewards for staking entry
     *
     * @param tokenId uint256 - Proof token ID
     */
    function pendingRewards(
        uint256 tokenId
    ) external view returns (uint256 rewards);

    /**
     * Updates the pool calculations for rewards, etc.
     */
    function updatePool() external;
}

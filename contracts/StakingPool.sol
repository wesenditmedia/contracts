// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BaseStakingPool.sol";

/**
 * @title WeSendit Staking Pool
 */
contract StakingPool is BaseStakingPool {
    constructor(
        address stakeTokenAddress,
        address proofTokenAddress
    ) BaseStakingPool(stakeTokenAddress, proofTokenAddress) {}

    function stake(
        uint256 amount,
        uint256 duration,
        bool enableAutoCompounding
    ) public onlyUnpaused nonReentrant returns (uint256 value) {
        // Validate inputs
        _validateStakingDuration(duration);
        _validateStakingAmount(amount);

        // Trigger pool update to make sure _accRewardsPerShare is up-to-date
        updatePool();

        // Transfer token to pool
        require(
            stakeToken().transferFrom(_msgSender(), address(this), amount),
            "Staking Pool: Failed to transfer token"
        );

        // Calculate shares multiplier based on max. APY / APR
        uint256 multiplier;
        if (enableAutoCompounding) {
            multiplier = apy(duration, 100 ether);
        } else {
            multiplier = apr(duration, 100 ether);
        }

        // Calculate pool shares for staking entry
        uint256 totalShares = (amount * multiplier) / 1e23;

        // Update global pool state
        _allocatedPoolShares += totalShares;
        _activeAllocatedPoolShares += totalShares;
        _totalTokenLocked += amount;

        // Calculate initial reward debt (similar to PancakeSwap staking / farms)
        uint256 rewardDebt = totalShares * accRewardsPerShare();

        // Create pool entry
        PoolEntry memory entry = PoolEntry(
            amount,
            duration,
            totalShares,
            rewardDebt,
            0,
            block.timestamp,
            block.timestamp,
            false,
            enableAutoCompounding
        );

        // Mint staking reward NFT
        // TODO: add NFT metadata
        uint256 tokenId = proofToken().mint(_msgSender());

        // Set pool enty
        _poolEntries[tokenId] = entry;

        // Emit event
        emit Staked(
            tokenId,
            amount,
            duration,
            totalShares,
            enableAutoCompounding
        );

        return tokenId;
    }

    function unstake(
        uint256 tokenId
    ) public onlyUnpaused onlyTokenOwner(tokenId) nonReentrant {
        // Get pool entry
        PoolEntry memory entry = poolEntry(tokenId);

        // Check if already unstaked
        require(
            !entry.isUnstaked,
            "Staking Pool: Staking entry was already unstaked"
        );

        // Check for staking lock period
        require(
            block.timestamp >=
                entry.startedAt + (entry.duration * SECONDS_PER_DAY),
            "Staking Pool: Staking entry is locked"
        );

        // Force rewards payout
        _claimRewards(tokenId);

        // Flag entry as unstaked
        _poolEntries[tokenId].isUnstaked = true;

        // Transfer initial stake amount back to sender
        require(
            stakeToken().transfer(_msgSender(), entry.amount),
            "Staking Pool: Failed to transfer initial stake"
        );

        // Update global pool state
        _allocatedPoolShares -= entry.shares;
        _totalTokenLocked -= entry.amount;

        // Trigger pool update
        updatePool();

        // Emit event
        emit Unstaked(
            tokenId,
            entry.amount,
            entry.duration,
            entry.shares,
            entry.isAutoCompoundingEnabled
        );
    }

    function claimRewards(
        uint256 tokenId
    ) public onlyUnpaused onlyTokenOwner(tokenId) nonReentrant {
        // Get pool entry
        PoolEntry memory entry = poolEntry(tokenId);

        // Check if already unstaked
        require(
            entry.isUnstaked == false,
            "Staking Pool: Staking entry was already unstaked"
        );

        // Require entry either to be non auto-compounding or already ended
        require(
            !entry.isAutoCompoundingEnabled ||
                block.timestamp >=
                (entry.startedAt + (entry.duration * SECONDS_PER_DAY)),
            "Staking Pool: Cannot claim before staking end"
        );

        // Claim rewards if available
        uint256 claimedRewards = _claimRewards(tokenId);
        require(
            claimedRewards > 0,
            "Staking Pool: No rewards available to claim"
        );

        // Trigger pool update
        updatePool();
    }

    function pendingRewards(
        uint256 tokenId
    ) public view returns (uint256 value) {
        // Get pool entry
        PoolEntry memory entry = poolEntry(tokenId);

        // If already unstaked, return zero
        if (entry.isUnstaked) {
            return 0;
        }

        // If we have already claimed this block, return zero
        if (entry.lastClaimedAt == block.timestamp) {
            return 0;
        }

        // Calculate rewards based on shares
        uint256 rewards;
        if (block.timestamp > lastRewardTimestamp()) {
            // If lastRewardTimestamp is in the past, calculate new values here
            rewards =
                entry.shares *
                _calculateAccRewardsPerShare(poolFactor(poolBalance()));
        } else {
            // If we've just updated, use static values here
            rewards = entry.shares * accRewardsPerShare();
        }

        // If we're exceeding staking duration, calculate rewards using
        // snapshot values around entry end timestamp and calculate
        // partial rewards
        uint256 durationInSeconds = entry.duration * SECONDS_PER_DAY;
        uint256 endTimestamp = entry.startedAt + durationInSeconds;

        // If we've already claimed after end, we've got all possible rewards
        if (entry.lastClaimedAt >= endTimestamp) {
            return 0;
        }

        if (block.timestamp > endTimestamp) {
            // Calculate historic rewards
            rewards = _calculateHistoricRewards(
                entry.shares,
                entry.startedAt,
                endTimestamp
            );
        }

        // Subtract reward debt from rewards
        uint256 totalRewards = rewards - entry.rewardDebt;

        // Calculate pool rewards fees
        uint256 fee = (totalRewards * 3) / 100;

        // Return pending rewards without fee and claimed rewards
        return totalRewards - fee - entry.claimedRewards;
    }

    function updatePool() public {
        // We've already updated this block
        if (lastRewardTimestamp() >= block.timestamp) {
            return;
        }

        // No one is currently staking, skipping update
        if (allocatedPoolShares() == 0) {
            _lastRewardTimestamp = block.timestamp;
            return;
        }

        // Calculate global pool factor
        _currentPoolFactor = poolFactor();

        // Calculate global rewards per share
        _accRewardsPerShare = _calculateAccRewardsPerShare();

        // Update last reward block
        _lastRewardTimestamp = block.timestamp;

        // Save values for snapshot
        _updateSnapshot(_accRewardsPerShareSnapshots, accRewardsPerShare());
        _updateSnapshot(_lastRewardTimestampSnapshots, lastRewardTimestamp());

        // Execute snapshot
        _snapshot();
    }

    /**
     * Claims rewards for the given entry
     *
     * @param tokenId uint256 - Proof token ID
     *
     * @return claimedRewards uint256 - Amount of rewards claimed
     */
    function _claimRewards(
        uint256 tokenId
    ) private returns (uint256 claimedRewards) {
        // Calculate claimable rewards
        uint256 rewards = pendingRewards(tokenId);
        if (rewards <= 0) {
            // No rewards available to claim
            return 0;
        }

        // Transfer rewards to sender
        require(
            stakeToken().transfer(_msgSender(), rewards),
            "Staking Pool: Failed to transfer rewards"
        );

        // Update staking entry
        _poolEntries[tokenId].claimedRewards += rewards;
        _poolEntries[tokenId].lastClaimedAt = block.timestamp;

        // Emit event
        emit RewardsClaimed(tokenId, claimedRewards);

        // Return claimed rewards
        return rewards;
    }
}

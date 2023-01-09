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
        address rewardTokenAddress
    ) BaseStakingPool(stakeTokenAddress, rewardTokenAddress) {}

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
        _totalDurationLocked += duration * SECONDS_PER_DAY;
        _totalTokenLocked += amount;

        // Calculate initial reward debt (similar to PancakeSwap staking / farms)
        uint256 rewardDebt = totalShares * _accRewardsPerShare;

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
        uint256 tokenId = rewardToken().mint(_msgSender());

        // Set pool enty
        _poolEntries[tokenId] = entry;

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
            entry.startedAt + (entry.duration * SECONDS_PER_DAY) >=
                block.timestamp,
            "Staking Pool: Staking entry is locked"
        );

        // Force rewards payout
        claimRewards(tokenId);

        // Flag entry as unstaked
        _poolEntries[tokenId].isUnstaked = true;

        // Transfer initial stake amount back to sender
        require(
            stakeToken().transfer(_msgSender(), entry.amount),
            "Staking Pool: Failed to transfer initial stake"
        );

        // Update global pool state
        _allocatedPoolShares -= entry.shares;
        _totalDurationLocked -= entry.duration * SECONDS_PER_DAY;
        _totalTokenLocked -= entry.amount;

        // Trigger pool update
        updatePool();
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

        if (entry.isAutoCompoundingEnabled) {
            // Staking with auto-compounding, check if end is reached
            require(
                block.timestamp >=
                    (entry.startedAt + (entry.duration * SECONDS_PER_DAY)),
                "Staking Pool: Cannot claim before staking end"
            );
        } else {
            // Staking without auto-compounding, check for claiming interval
            require(
                block.timestamp >=
                    (entry.lastClaimedAt + rewardsClaimInterval()),
                "Staking Pool: Already claimed within claiming interval"
            );
        }

        // Calculate claimable rewards
        uint256 rewards = pendingRewards(tokenId);
        require(rewards > 0, "Staking Pool: No rewards available to claim");

        // Transfer rewards to sender
        require(
            stakeToken().transfer(_msgSender(), rewards),
            "Staking Pool: Failed to transfer rewards"
        );

        // Update global pool state
        _totalDurationLocked -= block.timestamp - entry.startedAt;

        // Update staking entry
        _poolEntries[tokenId].claimedRewards += rewards;
        _poolEntries[tokenId].lastClaimedAt = block.timestamp;

        // Trigger pool update
        updatePool();
    }

    function pendingRewards(
        uint256 tokenId
    ) public view returns (uint256 value) {
        // Get pool entry
        PoolEntry memory entry = poolEntry(tokenId);

        // Calculate rewards based on shares
        uint256 rewards;
        if (block.timestamp > lastRewardTimestamp()) {
            // If lastRewardTimestamp is in the past, calculate new values here
            rewards =
                entry.shares *
                _calculateAccRewardsPerShareCustom(poolFactor(poolBalance()));
        } else {
            // If we've just updated, use static values here
            rewards = entry.shares * _accRewardsPerShare;
        }

        // If we're exceeding staking duration, calculate rewards using
        // snapshot values around entry end timestamp and calculate
        // partial rewards.
        uint256 durationInSeconds = entry.duration * SECONDS_PER_DAY;
        uint256 endTimestamp = entry.startedAt + durationInSeconds;
        if (
            durationInSeconds >= SECONDS_PER_DAY * maxDuration() &&
            block.timestamp > endTimestamp
        ) {
            // Calculate historic rewards
            rewards = _calculateHistoricRewards(entry.shares, endTimestamp);

            /**uint256 secondsSinceStart = block.timestamp - entry.startedAt;
            uint256 partialRewards = (rewards * durationInSeconds) /
                secondsSinceStart;

            rewards = partialRewards;*/
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

        // TODO: handle empty pool

        // Calculate global rewards per share
        _accRewardsPerShare = _calculateAccRewardsPerShare();

        // Calculate global pool factor
        _currentPoolFactor = poolFactor(poolBalance());

        // Update last reward block
        _lastRewardTimestamp = block.timestamp;

        // Save values for snapshot
        _updateSnapshot(_accRewardsPerShareSnapshots, _accRewardsPerShare);
        _updateSnapshot(_currentPoolFactorSnapshots, currentPoolFactor());
        _updateSnapshot(_lastRewardTimestampSnapshots, lastRewardTimestamp());

        // Execute snapshot
        _snapshot();
    }
}

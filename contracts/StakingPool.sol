// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

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
    ) external onlyUnpaused nonReentrant returns (uint256 value) {
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
            0,
            block.timestamp,
            block.timestamp,
            false,
            enableAutoCompounding
        );

        // Mint staking reward NFT
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
    ) external onlyUnpaused onlyTokenOwner(tokenId) nonReentrant {
        // Get pool entry
        PoolEntry memory entry = _poolEntries[tokenId];

        // Validate unstake action
        _validateUnstake(entry);

        // Unstake token
        // Check if user got pending rewards
        (uint256 rewards, uint256 totalFee) = _pendingRewards(entry);

        // Claim rewards or unstake if possible
        _claimOrUnstake(tokenId, entry, rewards, totalFee);

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

    function emergencyUnstake(
        uint256 tokenId
    ) external onlyTokenOwner(tokenId) {
        require(
            emergencyUnstakeEnabled(),
            "Staking Pool: Emergency unstake disabled"
        );

        PoolEntry memory entry = _poolEntries[tokenId];
        _unstake(tokenId, entry);
    }

    function claimRewards(
        uint256 tokenId
    ) external onlyUnpaused onlyTokenOwner(tokenId) nonReentrant {
        // Get pool entry
        PoolEntry memory entry = _poolEntries[tokenId];

        // Check if user got pending rewards
        (uint256 rewards, uint256 totalFee) = _pendingRewards(entry);
        require(rewards > 0, "Staking Pool: No rewards available to claim");

        // Claim rewards or unstake if possible
        _claimOrUnstake(tokenId, entry, rewards, totalFee);

        // Trigger pool update
        updatePool();
    }

    function claimMultipleRewards(
        uint256[] memory tokenIds
    ) external onlyUnpaused nonReentrant {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            // Get token ID
            uint256 tokenId = tokenIds[i];

            // Check if token owner is sender
            require(
                proofToken().ownerOf(tokenId) == _msgSender(),
                string(
                    abi.encodePacked(
                        "Staking Pool: Mismatching token owner for id: ",
                        tokenId
                    )
                )
            );

            // Get pool entry
            PoolEntry memory entry = _poolEntries[tokenId];

            // Check if user got pending rewards
            (uint256 rewards, uint256 totalFee) = _pendingRewards(entry);
            if (rewards > 0) {
                // Claim rewards
                _claimOrUnstake(tokenId, entry, rewards, totalFee);
            }
        }

        // Trigger pool update
        updatePool();
    }

    function pendingRewards(
        uint256 tokenId
    ) public view returns (uint256 value) {
        // Get pool entry
        PoolEntry memory entry = poolEntry(tokenId);

        // Calculate pending rewards
        (uint256 rewards, ) = _pendingRewards(entry);
        return rewards;
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

    function _claimOrUnstake(
        uint256 tokenId,
        PoolEntry memory entry,
        uint256 rewards,
        uint256 totalFee
    ) private {
        // Validate claim action
        _validateClaim(entry);

        if (rewards > 0) {
            // Claim rewards if available
            _claimRewards(tokenId, rewards, totalFee);

            // Update pool entry
            entry = _poolEntries[tokenId];
        }

        // Check if pool entry is expired and unstake
        if (
            block.timestamp >=
            entry.startedAt + (entry.duration * SECONDS_PER_DAY)
        ) {
            _unstake(tokenId, entry);
        }
    }

    function _pendingRewards(
        PoolEntry memory entry
    ) private view returns (uint256 availableRewards, uint256 totalFee) {
        // If already unstaked, return zero
        if (entry.isUnstaked) {
            return (0, 0);
        }

        // If we're exceeding staking duration, calculate rewards using
        // snapshot values around entry end timestamp and calculate
        // partial rewards
        uint256 durationInSeconds = entry.duration * SECONDS_PER_DAY;
        uint256 endTimestamp = entry.startedAt + durationInSeconds;

        // If we have already claimed this block or claimed after end, we've got all possible rewards
        if (
            entry.lastClaimedAt == block.timestamp ||
            entry.lastClaimedAt >= endTimestamp
        ) {
            return (0, 0);
        }

        // Calculate rewards based on shares
        uint256 rewards;
        if (block.timestamp > endTimestamp) {
            // Calculate historic rewards
            rewards = _calculateHistoricRewards(
                entry.shares,
                entry.startedAt,
                endTimestamp
            );
        } else if (block.timestamp > lastRewardTimestamp()) {
            // If lastRewardTimestamp is in the past, calculate new values here
            rewards = entry.shares * _calculateAccRewardsPerShare(poolFactor());
        } else {
            // If we've just updated, use static values here
            rewards = entry.shares * accRewardsPerShare();
        }

        // Subtract reward debt from rewards
        uint256 totalRewards = rewards - entry.rewardDebt;

        // Prevent underflow
        if (totalRewards < entry.claimedRewards + entry.collectedFees) {
            return (0, 0);
        }

        // Calculate available rewards
        uint256 unclaimedRewards = totalRewards -
            entry.claimedRewards -
            entry.collectedFees;

        // Calculate pool rewards fees
        uint256 fee = (unclaimedRewards * 3) / 100;

        // Return pending rewards without fee and claimed rewards
        return (unclaimedRewards - fee, fee);
    }

    /**
     * Claims rewards for the given entry
     *
     * @param tokenId uint256 - Proof token ID
     * @param rewards uint256 - Pending rewards
     * @param totalFee uint256 - Total fee subtracted from rewards
     */
    function _claimRewards(
        uint256 tokenId,
        uint256 rewards,
        uint256 totalFee
    ) private {
        // Transfer rewards to sender
        require(
            stakeToken().transfer(_msgSender(), rewards),
            "Staking Pool: Failed to transfer rewards"
        );

        // Update staking entry
        _poolEntries[tokenId].claimedRewards += rewards;
        _poolEntries[tokenId].collectedFees += totalFee;
        _poolEntries[tokenId].lastClaimedAt = block.timestamp;

        _reservedRewards += rewards;

        // Emit event
        emit RewardsClaimed(tokenId, rewards);
    }

    function _unstake(uint256 tokenId, PoolEntry memory entry) private {
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

        _reservedRewards -= entry.claimedRewards;
        _reservedFees += entry.collectedFees / 2;

        _activeAllocatedPoolShares -= entry.shares;
    }
}
